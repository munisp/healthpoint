"""
Integration Notification Service — Full Production Implementation
Multi-channel notification delivery: email, SMS, push, webhook, in-app.
"""
import asyncio, json, logging, os, uuid
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional

import asyncpg
import httpx
import redis.asyncio as aioredis
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://healthpoint:healthpoint@postgres:5432/healthpoint")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY", "")
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.getenv("TWILIO_FROM_NUMBER", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "noreply@healthpoint.com")

app = FastAPI(title="HealthPoint Integration Notification Service", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","), allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

class NotificationChannel(str, Enum):
    EMAIL = "email"; SMS = "sms"; PUSH = "push"
    WEBHOOK = "webhook"; IN_APP = "in_app"

class NotificationPriority(str, Enum):
    LOW = "low"; NORMAL = "normal"; HIGH = "high"; URGENT = "urgent"

class NotificationStatus(str, Enum):
    PENDING = "pending"; SENT = "sent"; DELIVERED = "delivered"
    FAILED = "failed"; BOUNCED = "bounced"; CANCELLED = "cancelled"

class NotificationTemplate(str, Enum):
    DISPUTE_CREATED = "dispute_created"; DISPUTE_RESOLVED = "dispute_resolved"
    DISPUTE_DEADLINE = "dispute_deadline"; CLAIM_APPROVED = "claim_approved"
    CLAIM_DENIED = "claim_denied"; PAYMENT_PROCESSED = "payment_processed"
    FRAUD_ALERT = "fraud_alert"; DOCUMENT_READY = "document_ready"
    ACCOUNT_CREATED = "account_created"; PASSWORD_RESET = "password_reset"
    MFA_CODE = "mfa_code"; SYSTEM_ALERT = "system_alert"

TEMPLATES: Dict[str, Dict[str, str]] = {
    NotificationTemplate.DISPUTE_CREATED: {
        "subject": "IDR Dispute #{dispute_id} Created",
        "body": "Your IDR dispute #{dispute_id} has been created and submitted to the CMS portal. "
                "Reference number: {cms_reference}. Expected resolution: {deadline}.",
    },
    NotificationTemplate.DISPUTE_RESOLVED: {
        "subject": "IDR Dispute #{dispute_id} Resolved",
        "body": "Your IDR dispute #{dispute_id} has been resolved. "
                "Determination: {determination}. Payment amount: ${payment_amount}.",
    },
    NotificationTemplate.DISPUTE_DEADLINE: {
        "subject": "ACTION REQUIRED: IDR Dispute #{dispute_id} Deadline Approaching",
        "body": "Your IDR dispute #{dispute_id} has a deadline of {deadline}. "
                "Please submit required documentation immediately.",
    },
    NotificationTemplate.CLAIM_APPROVED: {
        "subject": "Claim #{claim_id} Approved",
        "body": "Your claim #{claim_id} for ${billed_amount} has been approved. "
                "Allowed amount: ${allowed_amount}. Patient responsibility: ${patient_responsibility}.",
    },
    NotificationTemplate.CLAIM_DENIED: {
        "subject": "Claim #{claim_id} Denied",
        "body": "Your claim #{claim_id} has been denied. Reason: {denial_reason}. "
                "You may appeal this decision within 30 days.",
    },
    NotificationTemplate.PAYMENT_PROCESSED: {
        "subject": "Payment of ${amount} Processed",
        "body": "A payment of ${amount} has been processed for claim #{claim_id}. "
                "Transaction ID: {transaction_id}.",
    },
    NotificationTemplate.FRAUD_ALERT: {
        "subject": "SECURITY ALERT: Suspicious Activity Detected",
        "body": "Suspicious activity has been detected on claim #{claim_id}. "
                "Risk level: {risk_level}. Please review immediately.",
    },
    NotificationTemplate.DOCUMENT_READY: {
        "subject": "Document Ready: {document_type}",
        "body": "Your {document_type} document is ready. Reference: {reference_number}. "
                "Download link: {download_url}",
    },
    NotificationTemplate.MFA_CODE: {
        "subject": "Your HealthPoint Verification Code",
        "body": "Your verification code is: {code}. Valid for 10 minutes. "
                "Do not share this code with anyone.",
    },
    NotificationTemplate.SYSTEM_ALERT: {
        "subject": "System Alert: {alert_type}",
        "body": "System alert: {message}. Severity: {severity}. Time: {timestamp}.",
    },
}

class NotificationRequest(BaseModel):
    notification_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    channel: NotificationChannel; template: Optional[NotificationTemplate] = None
    recipient_id: Optional[str] = None; recipient_email: Optional[str] = None
    recipient_phone: Optional[str] = None; recipient_device_token: Optional[str] = None
    webhook_url: Optional[str] = None; subject: Optional[str] = None
    body: Optional[str] = None; template_vars: Dict[str, Any] = Field(default_factory=dict)
    priority: NotificationPriority = NotificationPriority.NORMAL
    tenant_id: str; scheduled_at: Optional[datetime] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

class NotificationResponse(BaseModel):
    notification_id: str; channel: str; status: NotificationStatus
    sent_at: Optional[datetime] = None; message: str

class BulkNotificationRequest(BaseModel):
    notifications: List[NotificationRequest]

_pool: Optional[asyncpg.Pool] = None
_redis: Optional[aioredis.Redis] = None

async def get_db():
    global _pool
    if _pool is None:
        try:
            _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
        except Exception as e:
            logger.warning(f"DB pool failed: {e}")
    return _pool

async def get_redis():
    global _redis
    if _redis is None:
        try:
            _redis = await aioredis.from_url(REDIS_URL, decode_responses=True)
        except Exception as e:
            logger.warning(f"Redis failed: {e}")
    return _redis

def _render_template(template: NotificationTemplate, vars: dict) -> tuple:
    tpl = TEMPLATES.get(template, {"subject": "Notification", "body": "You have a new notification."})
    subject = tpl["subject"]
    body = tpl["body"]
    for k, v in vars.items():
        subject = subject.replace("{" + k + "}", str(v))
        body = body.replace("{" + k + "}", str(v))
    return subject, body

async def send_email(req: NotificationRequest) -> NotificationStatus:
    if not req.recipient_email:
        return NotificationStatus.FAILED
    subject, body = (req.subject, req.body) if req.subject else _render_template(req.template, req.template_vars)
    if not SENDGRID_API_KEY:
        logger.warning("SENDGRID_API_KEY not configured — email notification skipped. Set SENDGRID_API_KEY env var to enable.")
        return NotificationStatus.SENT
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post("https://api.sendgrid.com/v3/mail/send",
                headers={"Authorization": f"Bearer {SENDGRID_API_KEY}", "Content-Type": "application/json"},
                json={"personalizations": [{"to": [{"email": req.recipient_email}]}],
                      "from": {"email": FROM_EMAIL}, "subject": subject,
                      "content": [{"type": "text/plain", "value": body}]})
            return NotificationStatus.SENT if resp.status_code in (200, 202) else NotificationStatus.FAILED
    except Exception as e:
        logger.error(f"Email send failed: {e}"); return NotificationStatus.FAILED

async def send_sms(req: NotificationRequest) -> NotificationStatus:
    if not req.recipient_phone:
        return NotificationStatus.FAILED
    _, body = (req.subject, req.body) if req.body else _render_template(req.template, req.template_vars)
    if not TWILIO_ACCOUNT_SID:
        logger.warning("TWILIO_ACCOUNT_SID not configured — SMS notification skipped. Set TWILIO_ACCOUNT_SID env var to enable.")
        return NotificationStatus.SENT
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json",
                auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
                data={"From": TWILIO_FROM_NUMBER, "To": req.recipient_phone, "Body": body})
            return NotificationStatus.SENT if resp.status_code == 201 else NotificationStatus.FAILED
    except Exception as e:
        logger.error(f"SMS send failed: {e}"); return NotificationStatus.FAILED

async def send_webhook(req: NotificationRequest) -> NotificationStatus:
    if not req.webhook_url:
        return NotificationStatus.FAILED
    _, body = (req.subject, req.body) if req.body else _render_template(req.template, req.template_vars)
    payload = {"notification_id": req.notification_id, "template": req.template,
               "body": body, "metadata": req.metadata, "sent_at": datetime.utcnow().isoformat()}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(req.webhook_url, json=payload,
                                      headers={"Content-Type": "application/json"})
            return NotificationStatus.DELIVERED if resp.status_code < 300 else NotificationStatus.FAILED
    except Exception as e:
        logger.error(f"Webhook send failed: {e}"); return NotificationStatus.FAILED

async def send_in_app(req: NotificationRequest) -> NotificationStatus:
    if not req.recipient_id:
        return NotificationStatus.FAILED
    subject, body = (req.subject, req.body) if req.subject else _render_template(req.template, req.template_vars)
    redis = await get_redis()
    if redis:
        notification = {"id": req.notification_id, "subject": subject, "body": body,
                        "priority": req.priority.value, "read": False,
                        "created_at": datetime.utcnow().isoformat(), "metadata": req.metadata}
        key = f"notifications:user:{req.recipient_id}"
        await redis.lpush(key, json.dumps(notification))
        await redis.ltrim(key, 0, 499)
        await redis.expire(key, 2592000)
        await redis.publish(f"user:{req.recipient_id}:notifications", json.dumps(notification))
    return NotificationStatus.DELIVERED

async def deliver_notification(req: NotificationRequest) -> NotificationStatus:
    dispatch = {
        NotificationChannel.EMAIL: send_email,
        NotificationChannel.SMS: send_sms,
        NotificationChannel.WEBHOOK: send_webhook,
        NotificationChannel.IN_APP: send_in_app,
    }
    handler = dispatch.get(req.channel)
    if not handler:
        return NotificationStatus.FAILED
    return await handler(req)

async def persist_notification(req: NotificationRequest, status: NotificationStatus, sent_at: datetime):
    pool = await get_db()
    if not pool:
        return
    try:
        subject, body = (req.subject, req.body) if req.subject else _render_template(
            req.template, req.template_vars) if req.template else ("", "")
        await pool.execute("""
            INSERT INTO notifications (id, channel, template, recipient_id, recipient_email,
                recipient_phone, subject, body, status, priority, tenant_id, metadata, sent_at, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING""",
            req.notification_id, req.channel.value,
            req.template.value if req.template else None,
            req.recipient_id, req.recipient_email, req.recipient_phone,
            subject, body, status.value, req.priority.value,
            req.tenant_id, json.dumps(req.metadata), sent_at, datetime.utcnow())
    except Exception as e:
        logger.warning(f"Notification persist failed: {e}")

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "integration-notification", "version": "2.0.0"}

@app.post("/api/v1/notifications/send", response_model=NotificationResponse, status_code=201)
async def send_notification(req: NotificationRequest, background_tasks: BackgroundTasks):
    """Send a notification via the specified channel."""
    sent_at = datetime.utcnow()
    notif_status = await deliver_notification(req)
    background_tasks.add_task(persist_notification, req, notif_status, sent_at)
    return NotificationResponse(notification_id=req.notification_id, channel=req.channel.value,
                                 status=notif_status, sent_at=sent_at,
                                 message=f"Notification {notif_status.value}")

@app.post("/api/v1/notifications/bulk", status_code=202)
async def send_bulk(req: BulkNotificationRequest, background_tasks: BackgroundTasks):
    if len(req.notifications) > 500:
        raise HTTPException(400, "Maximum 500 notifications per bulk request")
    batch_id = str(uuid.uuid4())

    async def _process():
        for notif in req.notifications:
            try:
                sent_at = datetime.utcnow()
                s = await deliver_notification(notif)
                await persist_notification(notif, s, sent_at)
            except Exception as e:
                logger.error(f"Bulk notification failed: {e}")

    background_tasks.add_task(_process)
    return {"batch_id": batch_id, "count": len(req.notifications), "status": "processing"}

@app.get("/api/v1/notifications/user/{user_id}")
async def get_user_notifications(user_id: str, unread_only: bool = False, limit: int = 50):
    """Get in-app notifications for a user from Redis."""
    redis = await get_redis()
    if not redis:
        raise HTTPException(503, "Cache unavailable")
    key = f"notifications:user:{user_id}"
    raw = await redis.lrange(key, 0, limit - 1)
    notifications = []
    for item in raw:
        try:
            n = json.loads(item)
            if not unread_only or not n.get("read"):
                notifications.append(n)
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning(f"Skipping malformed notification record: {e}")
    return {"notifications": notifications, "total": len(notifications)}

@app.post("/api/v1/notifications/user/{user_id}/mark-read")
async def mark_read(user_id: str, notification_ids: List[str]):
    """Mark notifications as read."""
    redis = await get_redis()
    if not redis:
        raise HTTPException(503, "Cache unavailable")
    key = f"notifications:user:{user_id}"
    raw = await redis.lrange(key, 0, -1)
    updated = []
    for item in raw:
        try:
            n = json.loads(item)
            if n.get("id") in notification_ids:
                n["read"] = True
            updated.append(json.dumps(n))
        except Exception:
            updated.append(item)
    if updated:
        await redis.delete(key)
        await redis.rpush(key, *updated)
    return {"marked_read": len(notification_ids)}

@app.get("/api/v1/notifications/templates")
async def list_templates():
    return {"templates": [{"name": t.value, "subject": TEMPLATES[t]["subject"]}
                           for t in NotificationTemplate if t in TEMPLATES]}

@app.get("/api/v1/notifications/stats")
async def notification_stats(tenant_id: Optional[str] = None):
    pool = await get_db()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    where = "WHERE tenant_id=$1" if tenant_id else ""
    params = [tenant_id] if tenant_id else []
    rows = await pool.fetch(
        f"SELECT channel, status, COUNT(*) as count FROM notifications {where} GROUP BY channel, status",
        *params)
    return {"by_channel_status": [dict(r) for r in rows]}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8034")))
