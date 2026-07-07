"""
Healthcare Claims Platform - Backup Service
Automated backup and disaster recovery with encryption and multi-destination support.

Author: Manus AI
Date: October 8, 2025
Port: 8014
"""


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

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, status, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any, Union
from datetime import datetime, timedelta
from enum import Enum
import uuid
import logging
import asyncio
import asyncpg

import json
import os
import shutil
import subprocess
from contextlib import asynccontextmanager
import boto3
from botocore.exceptions import ClientError
import tarfile
import gzip
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import base64
import aiofiles
from pathlib import Path
import schedule
import time as time_module

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
BACKUP_ENCRYPTION_KEY = os.getenv("BACKUP_ENCRYPTION_KEY", "your-backup-encryption-key")
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
S3_BACKUP_BUCKET = os.getenv("S3_BACKUP_BUCKET", "healthcare-platform-backups")
LOCAL_BACKUP_PATH = os.getenv("LOCAL_BACKUP_PATH", "/var/backups/healthcare-platform")

class BackupType(str, Enum):
    FULL = "full"
    INCREMENTAL = "incremental"
    DIFFERENTIAL = "differential"
    TRANSACTION_LOG = "transaction_log"

class BackupStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class BackupDestination(str, Enum):
    LOCAL = "local"
    S3 = "s3"
    AZURE = "azure"
    GCP = "gcp"
    FTP = "ftp"

class RestoreStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

# Pydantic Models
class BackupConfiguration(BaseModel):
    name: str
    description: Optional[str] = None
    backup_type: BackupType
    source_databases: List[str] = []
    source_directories: List[str] = []
    destinations: List[BackupDestination] = [BackupDestination.LOCAL]
    schedule_cron: Optional[str] = None  # e.g., "0 2 * * *" for daily at 2 AM
    retention_days: int = Field(default=30, ge=1, le=365)
    compression_enabled: bool = True
    encryption_enabled: bool = True
    notification_emails: List[str] = []
    is_active: bool = True
    tenant_id: Optional[str] = None
    created_by: str

class BackupJob(BaseModel):
    id: str
    configuration_id: str
    backup_type: BackupType
    status: BackupStatus
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    file_path: Optional[str] = None
    file_size: Optional[int] = None
    compressed_size: Optional[int] = None
    checksum: Optional[str] = None
    error_message: Optional[str] = None
    destinations_completed: List[BackupDestination] = []
    tenant_id: Optional[str] = None

class RestoreRequest(BaseModel):
    backup_job_id: str
    target_database: Optional[str] = None
    target_directory: Optional[str] = None
    restore_point: Optional[datetime] = None
    overwrite_existing: bool = False
    requested_by: str

class RestoreJob(BaseModel):
    id: str
    backup_job_id: str
    status: RestoreStatus
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    target_database: Optional[str] = None
    target_directory: Optional[str] = None
    error_message: Optional[str] = None
    requested_by: str

# Encryption Manager
class BackupEncryption:
    def __init__(self, key: str):
        self.key = key.encode()
        self.fernet = self._create_fernet()

    def _create_fernet(self):
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b'healthcare_backup_salt',
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(self.key))
        return Fernet(key)

    def encrypt_file(self, input_path: str, output_path: str):
        """Encrypt a file"""
        with open(input_path, 'rb') as infile:
            data = infile.read()
        
        encrypted_data = self.fernet.encrypt(data)
        
        with open(output_path, 'wb') as outfile:
            outfile.write(encrypted_data)

    def decrypt_file(self, input_path: str, output_path: str):
        """Decrypt a file"""
        with open(input_path, 'rb') as infile:
            encrypted_data = infile.read()
        
        decrypted_data = self.fernet.decrypt(encrypted_data)
        
        with open(output_path, 'wb') as outfile:
            outfile.write(decrypted_data)

encryption_manager = BackupEncryption(BACKUP_ENCRYPTION_KEY)

# Database Manager
class DatabaseManager:
    def __init__(self):
        self.pool = None

    async def connect(self):
        self.pool = await asyncpg.create_pool(DATABASE_URL)
        await self._create_tables()

    async def disconnect(self):
        if self.pool:
            await self.pool.close()

    async def _create_tables(self):
        async with self.pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS backup_configurations (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    backup_type VARCHAR(20) NOT NULL,
                    source_databases TEXT[],
                    source_directories TEXT[],
                    destinations TEXT[],
                    schedule_cron VARCHAR(100),
                    retention_days INTEGER DEFAULT 30,
                    compression_enabled BOOLEAN DEFAULT TRUE,
                    encryption_enabled BOOLEAN DEFAULT TRUE,
                    notification_emails TEXT[],
                    is_active BOOLEAN DEFAULT TRUE,
                    tenant_id VARCHAR(255),
                    created_by VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS backup_jobs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    configuration_id UUID NOT NULL,
                    backup_type VARCHAR(20) NOT NULL,
                    status VARCHAR(20) DEFAULT 'pending',
                    started_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    file_path TEXT,
                    file_size BIGINT,
                    compressed_size BIGINT,
                    checksum VARCHAR(255),
                    error_message TEXT,
                    destinations_completed TEXT[],
                    tenant_id VARCHAR(255),
                    created_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (configuration_id) REFERENCES backup_configurations(id)
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS restore_jobs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    backup_job_id UUID NOT NULL,
                    status VARCHAR(20) DEFAULT 'pending',
                    started_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    target_database VARCHAR(255),
                    target_directory TEXT,
                    error_message TEXT,
                    requested_by VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (backup_job_id) REFERENCES backup_jobs(id)
                );
            """)
            
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_backup_jobs_status ON backup_jobs(status);
                CREATE INDEX IF NOT EXISTS idx_backup_jobs_created ON backup_jobs(created_at);
                CREATE INDEX IF NOT EXISTS idx_restore_jobs_status ON restore_jobs(status);
            """)

db_manager = DatabaseManager()

# Backup Manager
class BackupManager:
    def __init__(self):
        self.redis_client = None
        self.s3_client = None
        self.running_jobs = {}

    async def _get_redis_client(self):
        if not self.redis_client:
            self.redis_client = get_redis_client()
        return self.redis_client

    def _get_s3_client(self):
        if not self.s3_client and AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY:
            self.s3_client = boto3.client(
                's3',
                aws_access_key_id=AWS_ACCESS_KEY_ID,
                aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
                region_name=AWS_REGION
            )
        return self.s3_client

    async def create_backup_configuration(self, config: BackupConfiguration) -> str:
        """Create a new backup configuration"""
        config_id = str(uuid.uuid4())
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO backup_configurations 
                (id, name, description, backup_type, source_databases, source_directories,
                 destinations, schedule_cron, retention_days, compression_enabled,
                 encryption_enabled, notification_emails, is_active, tenant_id, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            """, config_id, config.name, config.description, config.backup_type.value,
                [db for db in config.source_databases], [dir for dir in config.source_directories],
                [dest.value for dest in config.destinations], config.schedule_cron,
                config.retention_days, config.compression_enabled, config.encryption_enabled,
                config.notification_emails, config.is_active, config.tenant_id, config.created_by)
        
        logger.info(f"Created backup configuration: {config.name}")
        return config_id

    async def start_backup_job(self, configuration_id: str, backup_type: Optional[BackupType] = None) -> str:
        """Start a backup job"""
        # Get configuration
        async with db_manager.pool.acquire() as conn:
            config_row = await conn.fetchrow("""
                SELECT * FROM backup_configurations 
                WHERE id = $1 AND is_active = TRUE
            """, configuration_id)
            
            if not config_row:
                raise HTTPException(status_code=404, detail="Backup configuration not found")
            
            config_data = dict(config_row)
        
        # Create backup job
        job_id = str(uuid.uuid4())
        job_type = backup_type or BackupType(config_data['backup_type'])
        
        job = BackupJob(
            id=job_id,
            configuration_id=configuration_id,
            backup_type=job_type,
            status=BackupStatus.PENDING,
            tenant_id=config_data['tenant_id']
        )
        
        await self._save_backup_job(job)
        
        # Start backup in background
        asyncio.create_task(self._execute_backup_job(job, config_data))
        
        logger.info(f"Started backup job: {job_id}")
        return job_id

    async def _execute_backup_job(self, job: BackupJob, config: Dict[str, Any]):
        """Execute a backup job"""
        try:
            job.status = BackupStatus.RUNNING
            job.started_at = datetime.utcnow()
            await self._save_backup_job(job)
            
            # Create backup directory
            backup_dir = Path(LOCAL_BACKUP_PATH) / job.id
            backup_dir.mkdir(parents=True, exist_ok=True)
            
            backup_files = []
            
            # Backup databases
            for db_name in config['source_databases']:
                db_file = await self._backup_database(db_name, backup_dir)
                if db_file:
                    backup_files.append(db_file)
            
            # Backup directories
            for dir_path in config['source_directories']:
                dir_file = await self._backup_directory(dir_path, backup_dir)
                if dir_file:
                    backup_files.append(dir_file)
            
            if not backup_files:
                raise Exception("No data to backup")
            
            # Create archive
            archive_path = backup_dir / f"backup_{job.id}.tar"
            with tarfile.open(archive_path, 'w') as tar:
                for file_path in backup_files:
                    tar.add(file_path, arcname=Path(file_path).name)
            
            # Compress if enabled
            if config['compression_enabled']:
                compressed_path = f"{archive_path}.gz"
                with open(archive_path, 'rb') as f_in:
                    with gzip.open(compressed_path, 'wb') as f_out:
                        shutil.copyfileobj(f_in, f_out)
                os.remove(archive_path)
                archive_path = Path(compressed_path)
            
            # Encrypt if enabled
            if config['encryption_enabled']:
                encrypted_path = f"{archive_path}.enc"
                encryption_manager.encrypt_file(str(archive_path), encrypted_path)
                os.remove(archive_path)
                archive_path = Path(encrypted_path)
            
            # Calculate file info
            file_size = archive_path.stat().st_size
            checksum = await self._calculate_checksum(str(archive_path))
            
            job.file_path = str(archive_path)
            job.file_size = file_size
            job.checksum = checksum
            
            # Upload to destinations
            destinations = [BackupDestination(dest) for dest in config['destinations']]
            for destination in destinations:
                try:
                    await self._upload_to_destination(archive_path, destination, job.id)
                    job.destinations_completed.append(destination)
                except Exception as e:
                    logger.error(f"Failed to upload to {destination}: {e}")
            
            job.status = BackupStatus.COMPLETED
            job.completed_at = datetime.utcnow()
            
            # Send notification
            if config['notification_emails']:
                await self._send_backup_notification(job, config, success=True)
            
            # Cleanup old backups
            await self._cleanup_old_backups(config['retention_days'])
            
        except Exception as e:
            logger.error(f"Backup job {job.id} failed: {e}")
            job.status = BackupStatus.FAILED
            job.error_message = str(e)
            job.completed_at = datetime.utcnow()
            
            # Send failure notification
            if config.get('notification_emails'):
                await self._send_backup_notification(job, config, success=False)
        
        finally:
            await self._save_backup_job(job)
            self.running_jobs.pop(job.id, None)

    async def _backup_database(self, db_name: str, backup_dir: Path) -> Optional[str]:
        """Backup a PostgreSQL database"""
        try:
            output_file = backup_dir / f"{db_name}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.sql"
            
            # Use pg_dump to create database backup
            cmd = [
                'pg_dump',
                '--host=localhost',
                '--username=postgres',
                '--no-password',
                '--format=custom',
                '--file', str(output_file),
                db_name
            ]
            
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await process.communicate()
            
            if process.returncode == 0:
                logger.info(f"Database backup completed: {db_name}")
                return str(output_file)
            else:
                logger.error(f"Database backup failed: {stderr.decode()}")
                return None
                
        except Exception as e:
            logger.error(f"Database backup error: {e}")
            return None

    async def _backup_directory(self, dir_path: str, backup_dir: Path) -> Optional[str]:
        """Backup a directory"""
        try:
            source_path = Path(dir_path)
            if not source_path.exists():
                logger.warning(f"Directory not found: {dir_path}")
                return None
            
            output_file = backup_dir / f"{source_path.name}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.tar"
            
            with tarfile.open(output_file, 'w') as tar:
                tar.add(source_path, arcname=source_path.name)
            
            logger.info(f"Directory backup completed: {dir_path}")
            return str(output_file)
            
        except Exception as e:
            logger.error(f"Directory backup error: {e}")
            return None

    async def _upload_to_destination(self, file_path: Path, destination: BackupDestination, job_id: str):
        """Upload backup to destination"""
        if destination == BackupDestination.S3:
            await self._upload_to_s3(file_path, job_id)
        elif destination == BackupDestination.LOCAL:
            # Backup is already written locally; ensure it's in the configured backup directory
            backup_dir = os.getenv("LOCAL_BACKUP_DIR", "/var/backups/healthpoint")
            os.makedirs(backup_dir, exist_ok=True)
            dest_path = os.path.join(backup_dir, os.path.basename(file_path))
            if str(file_path) != dest_path:
                import shutil
                shutil.copy2(file_path, dest_path)
                logger.info(f"Backup copied to local destination: {dest_path}")
        else:
            logger.warning(f"Destination {destination} not implemented yet")

    async def _upload_to_s3(self, file_path: Path, job_id: str):
        """Upload backup to S3"""
        s3_client = self._get_s3_client()
        if not s3_client:
            raise Exception("S3 client not configured")
        
        s3_key = f"backups/{datetime.utcnow().strftime('%Y/%m/%d')}/{job_id}/{file_path.name}"
        
        try:
            s3_client.upload_file(str(file_path), S3_BACKUP_BUCKET, s3_key)
            logger.info(f"Uploaded to S3: {s3_key}")
        except ClientError as e:
            raise Exception(f"S3 upload failed: {e}")

    async def _calculate_checksum(self, file_path: str) -> str:
        """Calculate SHA256 checksum of file"""
        import hashlib
        
        sha256_hash = hashlib.sha256()
        with open(file_path, "rb") as f:
            for byte_block in iter(lambda: f.read(4096), b""):
                sha256_hash.update(byte_block)
        
        return sha256_hash.hexdigest()

    async def _send_backup_notification(self, job: BackupJob, config: Dict[str, Any], success: bool):
        """Send backup completion notification"""
        subject = f"Backup {'Completed' if success else 'Failed'}: {config['name']}"
        
        if success:
            message = f"""
            Backup job completed successfully:
            
            Configuration: {config['name']}
            Job ID: {job.id}
            Started: {job.started_at}
            Completed: {job.completed_at}
            File Size: {job.file_size} bytes
            Destinations: {', '.join([dest.value for dest in job.destinations_completed])}
            """
        else:
            message = f"""
            Backup job failed:
            
            Configuration: {config['name']}
            Job ID: {job.id}
            Started: {job.started_at}
            Error: {job.error_message}
            """
        
        # Send via notification service
        try:
            async with httpx.AsyncClient() as client:
                await client.post('http://localhost:8006/send-notification', json={
                    'type': 'email',
                    'recipients': config['notification_emails'],
                    'subject': subject,
                    'message': message
                })
        except Exception as e:
            logger.error(f"Failed to send notification: {e}")

    async def _cleanup_old_backups(self, retention_days: int):
        """Clean up old backup files"""
        cutoff_date = datetime.utcnow() - timedelta(days=retention_days)
        
        async with db_manager.pool.acquire() as conn:
            old_jobs = await conn.fetch("""
                SELECT * FROM backup_jobs 
                WHERE created_at < $1 AND status = 'completed'
            """, cutoff_date)
            
            for job_row in old_jobs:
                job_data = dict(job_row)
                file_path = job_data.get('file_path')
                
                if file_path and os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                        logger.info(f"Deleted old backup file: {file_path}")
                    except Exception as e:
                        logger.error(f"Failed to delete backup file {file_path}: {e}")
                
                # Mark job as cleaned up
                await conn.execute("""
                    UPDATE backup_jobs SET file_path = NULL WHERE id = $1
                """, job_data['id'])

    async def start_restore_job(self, request: RestoreRequest) -> str:
        """Start a restore job"""
        # Get backup job info
        async with db_manager.pool.acquire() as conn:
            backup_row = await conn.fetchrow("""
                SELECT * FROM backup_jobs WHERE id = $1 AND status = 'completed'
            """, request.backup_job_id)
            
            if not backup_row:
                raise HTTPException(status_code=404, detail="Backup job not found or not completed")
            
            backup_data = dict(backup_row)
        
        # Create restore job
        restore_id = str(uuid.uuid4())
        restore_job = RestoreJob(
            id=restore_id,
            backup_job_id=request.backup_job_id,
            status=RestoreStatus.PENDING,
            target_database=request.target_database,
            target_directory=request.target_directory,
            requested_by=request.requested_by
        )
        
        await self._save_restore_job(restore_job)
        
        # Start restore in background
        asyncio.create_task(self._execute_restore_job(restore_job, backup_data, request))
        
        logger.info(f"Started restore job: {restore_id}")
        return restore_id

    async def _execute_restore_job(self, job: RestoreJob, backup_data: Dict[str, Any], request: RestoreRequest):
        """Execute a restore job"""
        try:
            job.status = RestoreStatus.RUNNING
            job.started_at = datetime.utcnow()
            await self._save_restore_job(job)
            
            backup_file = backup_data['file_path']
            if not backup_file or not os.path.exists(backup_file):
                raise Exception("Backup file not found")
            
            # Create temporary directory for restore
            restore_dir = Path(LOCAL_BACKUP_PATH) / "restore" / job.id
            restore_dir.mkdir(parents=True, exist_ok=True)
            
            # Decrypt if needed
            working_file = backup_file
            if backup_file.endswith('.enc'):
                decrypted_file = restore_dir / "decrypted_backup"
                encryption_manager.decrypt_file(backup_file, str(decrypted_file))
                working_file = str(decrypted_file)
            
            # Decompress if needed
            if working_file.endswith('.gz'):
                decompressed_file = restore_dir / "decompressed_backup.tar"
                with gzip.open(working_file, 'rb') as f_in:
                    with open(decompressed_file, 'wb') as f_out:
                        shutil.copyfileobj(f_in, f_out)
                working_file = str(decompressed_file)
            
            # Extract archive
            extract_dir = restore_dir / "extracted"
            extract_dir.mkdir(exist_ok=True)
            
            with tarfile.open(working_file, 'r') as tar:
                tar.extractall(extract_dir)
            
            # Perform restore based on target
            if request.target_database:
                await self._restore_database(extract_dir, request.target_database, request.overwrite_existing)
            
            if request.target_directory:
                await self._restore_directory(extract_dir, request.target_directory, request.overwrite_existing)
            
            job.status = RestoreStatus.COMPLETED
            job.completed_at = datetime.utcnow()
            
            # Cleanup temporary files
            shutil.rmtree(restore_dir, ignore_errors=True)
            
        except Exception as e:
            logger.error(f"Restore job {job.id} failed: {e}")
            job.status = RestoreStatus.FAILED
            job.error_message = str(e)
            job.completed_at = datetime.utcnow()
        
        finally:
            await self._save_restore_job(job)

    async def _restore_database(self, extract_dir: Path, target_db: str, overwrite: bool):
        """Restore database from backup"""
        # Find SQL files in extracted directory
        sql_files = list(extract_dir.glob("*.sql"))
        if not sql_files:
            raise Exception("No SQL files found in backup")
        
        for sql_file in sql_files:
            cmd = [
                'pg_restore',
                '--host=localhost',
                '--username=postgres',
                '--no-password',
                '--dbname', target_db,
                '--clean' if overwrite else '--no-clean',
                str(sql_file)
            ]
            
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await process.communicate()
            
            if process.returncode != 0:
                raise Exception(f"Database restore failed: {stderr.decode()}")

    async def _restore_directory(self, extract_dir: Path, target_dir: str, overwrite: bool):
        """Restore directory from backup"""
        target_path = Path(target_dir)
        
        if target_path.exists() and not overwrite:
            raise Exception(f"Target directory exists and overwrite is disabled: {target_dir}")
        
        # Find tar files in extracted directory
        tar_files = list(extract_dir.glob("*.tar"))
        if not tar_files:
            raise Exception("No directory archives found in backup")
        
        for tar_file in tar_files:
            with tarfile.open(tar_file, 'r') as tar:
                tar.extractall(target_path.parent)

    async def _save_backup_job(self, job: BackupJob):
        """Save backup job to database"""
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO backup_jobs 
                (id, configuration_id, backup_type, status, started_at, completed_at,
                 file_path, file_size, compressed_size, checksum, error_message,
                 destinations_completed, tenant_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                ON CONFLICT (id) DO UPDATE SET
                    status = EXCLUDED.status,
                    started_at = EXCLUDED.started_at,
                    completed_at = EXCLUDED.completed_at,
                    file_path = EXCLUDED.file_path,
                    file_size = EXCLUDED.file_size,
                    compressed_size = EXCLUDED.compressed_size,
                    checksum = EXCLUDED.checksum,
                    error_message = EXCLUDED.error_message,
                    destinations_completed = EXCLUDED.destinations_completed
            """, job.id, job.configuration_id, job.backup_type.value, job.status.value,
                job.started_at, job.completed_at, job.file_path, job.file_size,
                job.compressed_size, job.checksum, job.error_message,
                [dest.value for dest in job.destinations_completed], job.tenant_id)

    async def _save_restore_job(self, job: RestoreJob):
        """Save restore job to database"""
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO restore_jobs 
                (id, backup_job_id, status, started_at, completed_at, target_database,
                 target_directory, error_message, requested_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (id) DO UPDATE SET
                    status = EXCLUDED.status,
                    started_at = EXCLUDED.started_at,
                    completed_at = EXCLUDED.completed_at,
                    error_message = EXCLUDED.error_message
            """, job.id, job.backup_job_id, job.status.value, job.started_at,
                job.completed_at, job.target_database, job.target_directory,
                job.error_message, job.requested_by)

backup_manager = BackupManager()

# Lifespan manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_manager.connect()
    # Ensure backup directory exists
    Path(LOCAL_BACKUP_PATH).mkdir(parents=True, exist_ok=True)
    yield
    await db_manager.disconnect()

app = FastAPI(
    title="Healthcare Claims Platform - Backup Service",
    description="Automated backup and disaster recovery with encryption",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Endpoints
@app.post("/backup-configurations", status_code=status.HTTP_201_CREATED)
async def create_backup_configuration(config: BackupConfiguration,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create a new backup configuration"""
    config_id = await backup_manager.create_backup_configuration(config)
    return {"configuration_id": config_id}

@app.get("/backup-configurations")
async def list_backup_configurations(tenant_id: Optional[str] = None,
    current_user: TokenPayload = Depends(get_current_user),
):
    """List backup configurations"""
    query = "SELECT * FROM backup_configurations WHERE is_active = TRUE"
    params = []
    
    if tenant_id:
        query += " AND tenant_id = $1"
        params.append(tenant_id)
    
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return [dict(row) for row in rows]

@app.post("/backup-jobs", status_code=status.HTTP_201_CREATED)
async def start_backup_job(configuration_id: str, backup_type: Optional[BackupType] = None,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Start a backup job"""
    job_id = await backup_manager.start_backup_job(configuration_id, backup_type)
    return {"job_id": job_id}

@app.get("/backup-jobs")
async def list_backup_jobs(status: Optional[BackupStatus] = None, 
                          configuration_id: Optional[str] = None,
                          limit: int = 50,
                              current_user: TokenPayload = Depends(get_current_user),
                          ):
    """List backup jobs"""
    query = "SELECT * FROM backup_jobs WHERE 1=1"
    params = []
    
    if status:
        query += f" AND status = ${len(params) + 1}"
        params.append(status.value)
    
    if configuration_id:
        query += f" AND configuration_id = ${len(params) + 1}"
        params.append(configuration_id)
    
    query += f" ORDER BY created_at DESC LIMIT ${len(params) + 1}"
    params.append(limit)
    
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return [dict(row) for row in rows]

@app.get("/backup-jobs/{job_id}")
async def get_backup_job(job_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get backup job details"""
    async with db_manager.pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM backup_jobs WHERE id = $1", job_id)
        if not row:
            raise HTTPException(status_code=404, detail="Backup job not found")
        return dict(row)

@app.post("/restore-jobs", status_code=status.HTTP_201_CREATED)
async def start_restore_job(request: RestoreRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Start a restore job"""
    job_id = await backup_manager.start_restore_job(request)
    return {"job_id": job_id}

@app.get("/restore-jobs")
async def list_restore_jobs(status: Optional[RestoreStatus] = None, limit: int = 50,
    current_user: TokenPayload = Depends(get_current_user),
):
    """List restore jobs"""
    query = "SELECT * FROM restore_jobs WHERE 1=1"
    params = []
    
    if status:
        query += f" AND status = ${len(params) + 1}"
        params.append(status.value)
    
    query += f" ORDER BY created_at DESC LIMIT ${len(params) + 1}"
    params.append(limit)
    
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return [dict(row) for row in rows]

@app.get("/restore-jobs/{job_id}")
async def get_restore_job(job_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get restore job details"""
    async with db_manager.pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM restore_jobs WHERE id = $1", job_id)
        if not row:
            raise HTTPException(status_code=404, detail="Restore job not found")
        return dict(row)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "backup"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8014)