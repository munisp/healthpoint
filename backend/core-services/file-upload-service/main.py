"""
File Upload Service — Full Production Implementation
Secure multi-part file uploads with S3 storage, virus scanning, and audit logging.
"""
import asyncio, hashlib, io, logging, mimetypes, os, uuid
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional

import asyncpg, boto3
from botocore.exceptions import ClientError

# ── Shared HealthPoint infrastructure ─────────────────────────────────────────
import sys, os as _os
_repo_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)
from backend.shared.database import fetch, fetchrow, execute, fetchval, transaction, bootstrap_schema, get_pool
from backend.shared.cache import get_client as get_redis_client, rate_limit_check, set_json, get_json
from backend.shared.auth import get_current_user, require_role, require_admin, require_provider, security_headers_middleware, TokenPayload
from backend.shared.messaging import publish, Topics
# ─────────────────────────────────────────────────────────────────────────────

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATABASE_URL = os.environ["DATABASE_URL"]
S3_BUCKET = os.getenv("S3_BUCKET", "healthpoint-uploads")
S3_REGION = os.getenv("AWS_REGION", "us-east-1")
MAX_FILE_SIZE_BYTES = int(os.getenv("MAX_FILE_SIZE_MB", "50")) * 1024 * 1024

ALLOWED_MIME_TYPES = {
    "application/pdf", "image/jpeg", "image/png", "image/tiff",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain", "text/csv", "application/json", "application/xml", "application/zip",
}

setup_telemetry(service_name="file-upload-service", service_version="1.0.0")
app = FastAPI(title="HealthPoint File Upload Service", version="2.0.0")
instrument_fastapi(app)

app.middleware("http")(security_headers_middleware)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","), allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

class FileCategory(str, Enum):
    CLAIM_DOCUMENT = "claim_document"
    IDR_EVIDENCE = "idr_evidence"
    MEDICAL_RECORD = "medical_record"
    INSURANCE_CARD = "insurance_card"
    PROVIDER_AGREEMENT = "provider_agreement"
    GFE_DOCUMENT = "gfe_document"
    AUDIT_EVIDENCE = "audit_evidence"
    GENERAL = "general"

class ScanStatus(str, Enum):
    PENDING = "pending"; CLEAN = "clean"; INFECTED = "infected"
    FAILED = "failed"; SKIPPED = "skipped"

class UploadResponse(BaseModel):
    file_id: str; original_filename: str; mime_type: str
    file_size_bytes: int; category: str; s3_key: str
    checksum_sha256: str; scan_status: str
    presigned_url: Optional[str] = None; uploaded_at: datetime; message: str

_pool: Optional[asyncpg.Pool] = None

async def get_db_pool():
    global _pool
    if _pool is None:
        try:
            _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
            await _pool.execute("""
                CREATE TABLE IF NOT EXISTS file_uploads (
                    id VARCHAR(64) PRIMARY KEY, original_filename TEXT NOT NULL,
                    stored_filename TEXT NOT NULL, mime_type VARCHAR(128),
                    file_size_bytes BIGINT, category VARCHAR(64), s3_key TEXT,
                    s3_bucket VARCHAR(128), checksum_sha256 VARCHAR(64),
                    scan_status VARCHAR(32) DEFAULT 'pending', uploaded_by VARCHAR(64),
                    claim_id VARCHAR(64), dispute_id VARCHAR(64), version INTEGER DEFAULT 1,
                    deleted_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )""")
        except Exception as e:
            logger.warning(f"DB pool failed: {e}")
    return _pool

def _s3():
    return boto3.client("s3", region_name=S3_REGION)

def upload_s3(content, key, ctype, metadata=None):
    try:
        extra = {"ContentType": ctype, "ServerSideEncryption": "AES256"}
        if metadata:
            extra["Metadata"] = {str(k): str(v) for k, v in metadata.items()}
        _s3().put_object(Bucket=S3_BUCKET, Key=key, Body=content, **extra)
        return True
    except ClientError as e:
        logger.error(f"S3 upload failed: {e}"); return False

def presigned_url(key, expires=3600):
    try:
        return _s3().generate_presigned_url("get_object",
               Params={"Bucket": S3_BUCKET, "Key": key}, ExpiresIn=expires)
    except ClientError:
        return None

async def scan_file(content, filename):
    try:
        import clamd
        cd = clamd.ClamdUnixSocket()
        r = cd.instream(io.BytesIO(content)).get("stream", ("OK", None))
        return ScanStatus.CLEAN if r[0] == "OK" else ScanStatus.INFECTED
    except ImportError:
        return ScanStatus.SKIPPED
    except Exception:
        return ScanStatus.FAILED

def validate(content, filename, ctype):
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(413, f"File exceeds {MAX_FILE_SIZE_BYTES//1024//1024} MB limit")
    if len(content) == 0:
        raise HTTPException(400, "File is empty")
    detected = ctype or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    if detected not in ALLOWED_MIME_TYPES:
        raise HTTPException(415, f"File type '{detected}' not allowed")
    if ".." in filename or "/" in filename:
        raise HTTPException(400, "Invalid filename")

async def process_upload(content, filename, ctype, category, uploaded_by, claim_id, dispute_id, bg):
    validate(content, filename, ctype)
    file_id = str(uuid.uuid4())
    checksum = hashlib.sha256(content).hexdigest()
    ext = os.path.splitext(filename)[1].lower()
    date_pfx = datetime.utcnow().strftime("%Y/%m/%d")
    s3_key = f"uploads/{category.value}/{date_pfx}/{file_id}{ext}"

    scan = await scan_file(content, filename)
    if scan == ScanStatus.INFECTED:
        raise HTTPException(422, "File rejected: virus detected")

    if not upload_s3(content, s3_key, ctype,
                     {"original-filename": filename, "uploaded-by": uploaded_by or "anon",
                      "category": category.value, "checksum": checksum}):
        raise HTTPException(500, "Failed to store file")

    url = presigned_url(s3_key)

    async def _record():
        pool = await get_db_pool()
        if pool:
            try:
                await pool.execute(
                    """INSERT INTO file_uploads (id,original_filename,stored_filename,mime_type,
                       file_size_bytes,category,s3_key,s3_bucket,checksum_sha256,scan_status,
                       uploaded_by,claim_id,dispute_id,version,created_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)""",
                    file_id, filename, f"{file_id}{ext}", ctype, len(content),
                    category.value, s3_key, S3_BUCKET, checksum, scan.value,
                    uploaded_by, claim_id, dispute_id, 1, datetime.utcnow())
            except Exception as e:
                logger.warning(f"DB record failed: {e}")
    bg.add_task(_record)

    return UploadResponse(file_id=file_id, original_filename=filename, mime_type=ctype,
                          file_size_bytes=len(content), category=category.value, s3_key=s3_key,
                          checksum_sha256=checksum, scan_status=scan.value,
                          presigned_url=url, uploaded_at=datetime.utcnow(),
                          message="File uploaded successfully")

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "file-upload", "version": "2.0.0"}

@app.post("/upload-file/")
async def upload_legacy(file: UploadFile = File(...),
                        background_tasks: BackgroundTasks = BackgroundTasks(),
                            current_user: TokenPayload = Depends(get_current_user),
                        ):
    content = await file.read()
    return await process_upload(content, file.filename,
                                 file.content_type or "application/octet-stream",
                                 FileCategory.GENERAL, None, None, None, background_tasks)

@app.post("/api/v1/files/upload", response_model=UploadResponse, status_code=201)
async def upload_file(file: UploadFile = File(...),
                      category: FileCategory = Form(default=FileCategory.GENERAL),
                      claim_id: Optional[str] = Form(default=None),
                      dispute_id: Optional[str] = Form(default=None),
                      uploaded_by: Optional[str] = Form(default=None),
                      background_tasks: BackgroundTasks = BackgroundTasks(),
                          current_user: TokenPayload = Depends(get_current_user),
                      ):
    content = await file.read()
    return await process_upload(content, file.filename,
                                 file.content_type or "application/octet-stream",
                                 category, uploaded_by, claim_id, dispute_id, background_tasks)

@app.post("/api/v1/files/upload/bulk", status_code=201)
async def upload_bulk(files: List[UploadFile] = File(...),
                      category: FileCategory = Form(default=FileCategory.GENERAL),
                      claim_id: Optional[str] = Form(default=None),
                      dispute_id: Optional[str] = Form(default=None),
                      uploaded_by: Optional[str] = Form(default=None),
                      background_tasks: BackgroundTasks = BackgroundTasks(),
                          current_user: TokenPayload = Depends(get_current_user),
                      ):
    if len(files) > 20:
        raise HTTPException(400, "Maximum 20 files per bulk upload")
    batch_id = str(uuid.uuid4())
    results, ok, fail = [], 0, 0
    for f in files:
        try:
            content = await f.read()
            r = await process_upload(content, f.filename,
                                      f.content_type or "application/octet-stream",
                                      category, uploaded_by, claim_id, dispute_id, background_tasks)
            results.append({"filename": f.filename, "status": "success", "file_id": r.file_id})
            ok += 1
        except Exception as e:
            results.append({"filename": f.filename, "status": "error", "detail": str(e)})
            fail += 1
    return {"batch_id": batch_id, "total": len(files), "successful": ok, "failed": fail, "results": results}

@app.get("/api/v1/files/{file_id}")
async def get_file(file_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    pool = await get_db_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    row = await pool.fetchrow("SELECT * FROM file_uploads WHERE id=$1 AND deleted_at IS NULL", file_id)
    if not row:
        raise HTTPException(404, "File not found")
    r = dict(row)
    r["presigned_url"] = presigned_url(r["s3_key"])
    return r

@app.get("/api/v1/files")
async def list_files(category: Optional[str]=None, claim_id: Optional[str]=None,
                     dispute_id: Optional[str]=None, limit: int=Query(50, le=200), offset: int=0,
                         current_user: TokenPayload = Depends(get_current_user),
                     ):
    pool = await get_db_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    conds, params, idx = ["deleted_at IS NULL"], [], 1
    for col, val in [("category", category), ("claim_id", claim_id), ("dispute_id", dispute_id)]:
        if val:
            conds.append(f"{col}=${idx}"); params.append(val); idx += 1
    params.extend([limit, offset])
    rows = await pool.fetch(
        "SELECT * FROM file_uploads WHERE {' AND '.join(conds)} ORDER BY created_at DESC LIMIT $$1 OFFSET ${idx+1}", idx,
        *params)
    return {"files": [dict(r) for r in rows], "total": len(rows)}

@app.delete("/api/v1/files/{file_id}", status_code=204)
async def delete_file(file_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    pool = await get_db_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    row = await pool.fetchrow("SELECT s3_key, deleted_at FROM file_uploads WHERE id=$1", file_id)
    if not row:
        raise HTTPException(404, "File not found")
    if row["deleted_at"]:
        raise HTTPException(410, "File already deleted")
    try:
        _s3().delete_object(Bucket=S3_BUCKET, Key=row["s3_key"])
    except Exception:
        logger.warning("Non-fatal upload exception suppressed")
    await pool.execute("UPDATE file_uploads SET deleted_at=$1, updated_at=$1 WHERE id=$2",
                       datetime.utcnow(), file_id)

@app.get("/api/v1/files/stats/summary")
async def stats(,
    current_user: TokenPayload = Depends(get_current_user),
):
    pool = await get_db_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    rows = await pool.fetch("""SELECT category, scan_status, COUNT(*) as count,
        SUM(file_size_bytes) as total_bytes FROM file_uploads WHERE deleted_at IS NULL
        GROUP BY category, scan_status""")
    total = await pool.fetchrow("SELECT COUNT(*) as n, SUM(file_size_bytes) as b FROM file_uploads WHERE deleted_at IS NULL")
    return {"total_files": total["n"] or 0, "total_bytes": total["b"] or 0,
            "breakdown": [dict(r) for r in rows]}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8031")))