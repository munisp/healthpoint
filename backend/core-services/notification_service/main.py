#!/usr/bin/env python3
"""
Healthcare Claims Platform - Notification Service
Multi-channel communication, real-time alerts, and notification management.

Author: Manus AI
Date: October 5, 2025
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

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, status, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator, Field, EmailStr
from typing import List, Optional, Dict, Any, Union
from datetime import datetime, timedelta
from enum import Enum
import uuid
import logging
import asyncio
import asyncpg

import json
import os
from contextlib import asynccontextmanager
import httpx
import smtplib
from email.mime.text import MimeText
from email.mime.multipart import MimeMultipart
from email.mime.base import MimeBase
from email import encoders
import aiofiles
import jinja2
from twilio.rest import Client as TwilioClient
import websockets
from collections import defaultdict
from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# Email configuration
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")

# SMS configuration
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "")

# Push notification configuration
FIREBASE_SERVER_KEY = os.getenv("FIREBASE_SERVER_KEY", "")

class NotificationType(str, Enum):
    EMAIL = "email"
    SMS = "sms"
    PUSH = "push"
    IN_APP = "in_app"
    WEBHOOK = "webhook"

class NotificationPriority(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"
    CRITICAL = "critical"

class NotificationStatus(str, Enum):
    PENDING = "pending"
    SENT = "sent"
    DELIVERED = "delivered"
    FAILED = "failed"
    CANCELLED = "cancelled"

class NotificationCategory(str, Enum):
    CLAIM_UPDATE = "claim_update"
    PAYMENT_NOTIFICATION = "payment_notification"
    SYSTEM_ALERT = "system_alert"
    SECURITY_ALERT = "security_alert"
    REMINDER = "reminder"
    WELCOME = "welcome"
    BILLING = "billing"
    MAINTENANCE = "maintenance"

# Pydantic Models
class NotificationRecipient(BaseModel):
    user_id: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    push_token: Optional[str] = None
    webhook_url: Optional[str] = None
    preferences: Dict[str, Any] = {}

class NotificationTemplate(BaseModel):
    id: Optional[str] = None
    name: str
    category: NotificationCategory
    subject_template: str
    body_template: str
    html_template: Optional[str] = None
    sms_template: Optional[str] = None
    push_template: Optional[str] = None
    variables: List[str] = []
    active: bool = True

class NotificationRequest(BaseModel):
    recipients: List[NotificationRecipient]
    template_id: Optional[str] = None
    category: NotificationCategory
    priority: NotificationPriority = NotificationPriority.NORMAL
    channels: List[NotificationType]
    subject: Optional[str] = None
    message: str
    html_content: Optional[str] = None
    variables: Dict[str, Any] = {}
    attachments: List[str] = []
    scheduled_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    tenant_id: Optional[str] = None

class NotificationResponse(BaseModel):
    id: str
    status: NotificationStatus
    category: NotificationCategory
    priority: NotificationPriority
    channels: List[NotificationType]
    recipients_count: int
    sent_count: int
    delivered_count: int
    failed_count: int
    created_at: datetime
    sent_at: Optional[datetime] = None
    tenant_id: Optional[str] = None

class NotificationPreferences(BaseModel):
    user_id: str
    email_enabled: bool = True
    sms_enabled: bool = True
    push_enabled: bool = True
    in_app_enabled: bool = True
    categories: Dict[NotificationCategory, Dict[str, bool]] = {}
    quiet_hours_start: Optional[str] = None  # HH:MM format
    quiet_hours_end: Optional[str] = None
    timezone: str = "UTC"

class WebSocketConnection(BaseModel):
    websocket: WebSocket
    user_id: str
    tenant_id: Optional[str] = None
    connected_at: datetime

# Database connection management
class DatabaseManager:
    def __init__(self):
        self.pool = None
        self.redis = None
    
    async def connect(self):
        """Initialize database connections"""
        try:
            self.pool = await asyncpg.create_pool(DATABASE_URL)
            self.redis = get_redis_client()
            logger.info("Notification service database connections established")
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            raise
    
    async def disconnect(self):
        """Close database connections"""
        if self.pool:
            await self.pool.close()
        if self.redis:
            await self.redis.close()
        logger.info("Notification service database connections closed")

db_manager = DatabaseManager()

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocketConnection]] = defaultdict(list)
    
    async def connect(self, websocket: WebSocket, user_id: str, tenant_id: Optional[str] = None):
        """Accept WebSocket connection"""
        await websocket.accept()
        connection = WebSocketConnection(
            websocket=websocket,
            user_id=user_id,
            tenant_id=tenant_id,
            connected_at=datetime.utcnow()
        )
        self.active_connections[user_id].append(connection)
        logger.info(f"WebSocket connected for user {user_id}")
    
    def disconnect(self, user_id: str, websocket: WebSocket):
        """Remove WebSocket connection"""
        if user_id in self.active_connections:
            self.active_connections[user_id] = [
                conn for conn in self.active_connections[user_id] 
                if conn.websocket != websocket
            ]
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        logger.info(f"WebSocket disconnected for user {user_id}")
    
    async def send_personal_message(self, user_id: str, message: dict):
        """Send message to specific user"""
        if user_id in self.active_connections:
            disconnected = []
            for connection in self.active_connections[user_id]:
                try:
                    await connection.websocket.send_json(message)
                except Exception as e:
                    disconnected.append(connection)
            
            # Remove disconnected connections
            for conn in disconnected:
                self.disconnect(user_id, conn.websocket)
    
    async def broadcast_to_tenant(self, tenant_id: str, message: dict):
        """Broadcast message to all users in a tenant"""
        for user_id, connections in self.active_connections.items():
            for connection in connections:
                if connection.tenant_id == tenant_id:
                    try:
                        await connection.websocket.send_json(message)
                    except Exception as ws_err:
                        logger.warning(f"WebSocket send failed for tenant {tenant_id}: {ws_err}")

connection_manager = ConnectionManager()

# Template engine
template_env = jinja2.Environment(
    loader=jinja2.DictLoader({}),
    autoescape=jinja2.select_autoescape(['html', 'xml'])
)

# Notification channels
class EmailChannel:
    def __init__(self):
        self.smtp_server = SMTP_SERVER
        self.smtp_port = SMTP_PORT
        self.username = SMTP_USERNAME
        self.password = SMTP_PASSWORD
    
    async def send(self, recipient: NotificationRecipient, subject: str, message: str, 
                   html_content: Optional[str] = None, attachments: List[str] = []) -> bool:
        """Send email notification"""
        if not recipient.email:
            return False
        
        try:
            msg = MimeMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = self.username
            msg['To'] = recipient.email
            
            # Add text part
            text_part = MimeText(message, 'plain')
            msg.attach(text_part)
            
            # Add HTML part if provided
            if html_content:
                html_part = MimeText(html_content, 'html')
                msg.attach(html_part)
            
            # Add attachments
            for attachment_path in attachments:
                if os.path.exists(attachment_path):
                    with open(attachment_path, "rb") as attachment:
                        part = MimeBase('application', 'octet-stream')
                        part.set_payload(attachment.read())
                    
                    encoders.encode_base64(part)
                    part.add_header(
                        'Content-Disposition',
                        f'attachment; filename= {os.path.basename(attachment_path)}'
                    )
                    msg.attach(part)
            
            # Send email
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()
                server.login(self.username, self.password)
                server.send_message(msg)
            
            logger.info(f"Email sent to {recipient.email}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to send email to {recipient.email}: {e}")
            return False

class SMSChannel:
    def __init__(self):
        if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN:
            self.client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            self.from_number = TWILIO_PHONE_NUMBER
        else:
            self.client = None
    
    async def send(self, recipient: NotificationRecipient, message: str) -> bool:
        """Send SMS notification"""
        if not self.client or not recipient.phone:
            return False
        
        try:
            message = self.client.messages.create(
                body=message,
                from_=self.from_number,
                to=recipient.phone
            )
            
            logger.info(f"SMS sent to {recipient.phone}: {message.sid}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to send SMS to {recipient.phone}: {e}")
            return False

class PushChannel:
    def __init__(self):
        self.server_key = FIREBASE_SERVER_KEY
    
    async def send(self, recipient: NotificationRecipient, title: str, message: str, data: Dict[str, Any] = {}) -> bool:
        """Send push notification"""
        if not self.server_key or not recipient.push_token:
            return False
        
        try:
            headers = {
                'Authorization': f'key={self.server_key}',
                'Content-Type': 'application/json'
            }
            
            payload = {
                'to': recipient.push_token,
                'notification': {
                    'title': title,
                    'body': message
                },
                'data': data
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    'https://fcm.googleapis.com/fcm/send',
                    headers=headers,
                    json=payload
                )
                
                if response.status_code == 200:
                    logger.info(f"Push notification sent to {recipient.push_token}")
                    return True
                else:
                    logger.error(f"Failed to send push notification: {response.text}")
                    return False
                    
        except Exception as e:
            logger.error(f"Failed to send push notification: {e}")
            return False

class WebhookChannel:
    async def send(self, recipient: NotificationRecipient, payload: Dict[str, Any]) -> bool:
        """Send webhook notification"""
        if not recipient.webhook_url:
            return False
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    recipient.webhook_url,
                    json=payload,
                    timeout=30
                )
                
                if response.status_code < 400:
                    logger.info(f"Webhook sent to {recipient.webhook_url}")
                    return True
                else:
                    logger.error(f"Webhook failed: {response.status_code}")
                    return False
                    
        except Exception as e:
            logger.error(f"Failed to send webhook: {e}")
            return False

# Notification service
class NotificationService:
    def __init__(self):
        self.email_channel = EmailChannel()
        self.sms_channel = SMSChannel()
        self.push_channel = PushChannel()
        self.webhook_channel = WebhookChannel()
    
    async def send_notification(self, request: NotificationRequest, background_tasks: BackgroundTasks) -> NotificationResponse:
        """Send notification to recipients"""
        notification_id = str(uuid.uuid4())
        
        # Store notification record
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO notifications (
                    id, category, priority, channels, subject, message, html_content,
                    variables, attachments, scheduled_at, expires_at, tenant_id,
                    recipients_count, status, created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            """, 
                notification_id, request.category.value, request.priority.value,
                json.dumps([ch.value for ch in request.channels]), request.subject,
                request.message, request.html_content, json.dumps(request.variables),
                json.dumps(request.attachments), request.scheduled_at, request.expires_at,
                request.tenant_id, len(request.recipients), NotificationStatus.PENDING.value,
                datetime.utcnow()
            )
            
            # Store recipients
            for recipient in request.recipients:
                await conn.execute("""
                    INSERT INTO notification_recipients (
                        notification_id, user_id, email, phone, push_token, webhook_url, preferences
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                """, 
                    notification_id, recipient.user_id, recipient.email, recipient.phone,
                    recipient.push_token, recipient.webhook_url, json.dumps(recipient.preferences)
                )
        
        # Schedule or send immediately
        if request.scheduled_at and request.scheduled_at > datetime.utcnow():
            background_tasks.add_task(self._schedule_notification, notification_id, request.scheduled_at)
        else:
            background_tasks.add_task(self._process_notification, notification_id)
        
        return NotificationResponse(
            id=notification_id,
            status=NotificationStatus.PENDING,
            category=request.category,
            priority=request.priority,
            channels=request.channels,
            recipients_count=len(request.recipients),
            sent_count=0,
            delivered_count=0,
            failed_count=0,
            created_at=datetime.utcnow(),
            tenant_id=request.tenant_id
        )
    
    async def _schedule_notification(self, notification_id: str, scheduled_at: datetime):
        """Schedule notification for later delivery"""
        delay = (scheduled_at - datetime.utcnow()).total_seconds()
        if delay > 0:
            await asyncio.sleep(delay)
        
        await self._process_notification(notification_id)
    
    async def _process_notification(self, notification_id: str):
        """Process and send notification"""
        try:
            async with db_manager.pool.acquire() as conn:
                # Get notification details
                notification = await conn.fetchrow("""
                    SELECT * FROM notifications WHERE id = $1
                """, notification_id)
                
                if not notification or notification["status"] != NotificationStatus.PENDING.value:
                    return
                
                # Check if expired
                if notification["expires_at"] and notification["expires_at"] < datetime.utcnow():
                    await conn.execute("""
                        UPDATE notifications SET status = $1, updated_at = $2 WHERE id = $3
                    """, NotificationStatus.CANCELLED.value, datetime.utcnow(), notification_id)
                    return
                
                # Get recipients
                recipients = await conn.fetch("""
                    SELECT * FROM notification_recipients WHERE notification_id = $1
                """, notification_id)
                
                # Get template if specified
                template = None
                if notification.get("template_id"):
                    template = await conn.fetchrow("""
                        SELECT * FROM notification_templates WHERE id = $1 AND active = true
                    """, notification["template_id"])
                
                # Update status to sending
                await conn.execute("""
                    UPDATE notifications SET status = $1, sent_at = $2, updated_at = $2 WHERE id = $3
                """, NotificationStatus.SENT.value, datetime.utcnow(), notification_id)
            
            # Process each recipient
            channels = json.loads(notification["channels"])
            variables = json.loads(notification["variables"]) if notification["variables"] else {}
            
            sent_count = 0
            failed_count = 0
            
            for recipient_data in recipients:
                recipient = NotificationRecipient(
                    user_id=recipient_data["user_id"],
                    email=recipient_data["email"],
                    phone=recipient_data["phone"],
                    push_token=recipient_data["push_token"],
                    webhook_url=recipient_data["webhook_url"],
                    preferences=json.loads(recipient_data["preferences"]) if recipient_data["preferences"] else {}
                )
                
                # Check user preferences
                if not await self._check_user_preferences(recipient.user_id, notification["category"], channels):
                    continue
                
                # Render content
                subject = await self._render_template(notification["subject"], variables) if notification["subject"] else ""
                message = await self._render_template(notification["message"], variables)
                html_content = await self._render_template(notification["html_content"], variables) if notification["html_content"] else None
                
                # Send through each channel
                success = False
                for channel in channels:
                    try:
                        if channel == NotificationType.EMAIL.value:
                            success = await self.email_channel.send(recipient, subject, message, html_content, json.loads(notification["attachments"]) if notification["attachments"] else [])
                        elif channel == NotificationType.SMS.value:
                            success = await self.sms_channel.send(recipient, message)
                        elif channel == NotificationType.PUSH.value:
                            success = await self.push_channel.send(recipient, subject, message, variables)
                        elif channel == NotificationType.IN_APP.value:
                            success = await self._send_in_app(recipient, subject, message, variables)
                        elif channel == NotificationType.WEBHOOK.value:
                            success = await self.webhook_channel.send(recipient, {
                                "notification_id": notification_id,
                                "subject": subject,
                                "message": message,
                                "variables": variables
                            })
                        
                        if success:
                            break  # Success on any channel counts
                            
                    except Exception as e:
                        logger.error(f"Failed to send via {channel}: {e}")
                
                if success:
                    sent_count += 1
                else:
                    failed_count += 1
                
                # Log delivery attempt
                await self._log_delivery_attempt(notification_id, recipient.user_id, channels, success)
            
            # Update final status
            async with db_manager.pool.acquire() as conn:
                await conn.execute("""
                    UPDATE notifications 
                    SET sent_count = $1, failed_count = $2, updated_at = $3
                    WHERE id = $4
                """, sent_count, failed_count, datetime.utcnow(), notification_id)
            
            logger.info(f"Notification {notification_id} processed: {sent_count} sent, {failed_count} failed")
            
        except Exception as e:
            logger.error(f"Failed to process notification {notification_id}: {e}")
            
            # Update status to failed
            async with db_manager.pool.acquire() as conn:
                await conn.execute("""
                    UPDATE notifications SET status = $1, updated_at = $2 WHERE id = $3
                """, NotificationStatus.FAILED.value, datetime.utcnow(), notification_id)
    
    async def _render_template(self, template_str: str, variables: Dict[str, Any]) -> str:
        """Render template with variables"""
        if not template_str:
            return ""
        
        try:
            template = template_env.from_string(template_str)
            return template.render(**variables)
        except Exception as e:
            logger.error(f"Template rendering failed: {e}")
            return template_str
    
    async def _check_user_preferences(self, user_id: str, category: str, channels: List[str]) -> bool:
        """Check if user allows notifications for this category and channels"""
        try:
            async with db_manager.pool.acquire() as conn:
                prefs = await conn.fetchrow("""
                    SELECT * FROM notification_preferences WHERE user_id = $1
                """, user_id)
                
                if not prefs:
                    return True  # Default to allow if no preferences set
                
                # Check global channel preferences
                for channel in channels:
                    if channel == NotificationType.EMAIL.value and not prefs.get("email_enabled", True):
                        return False
                    elif channel == NotificationType.SMS.value and not prefs.get("sms_enabled", True):
                        return False
                    elif channel == NotificationType.PUSH.value and not prefs.get("push_enabled", True):
                        return False
                    elif channel == NotificationType.IN_APP.value and not prefs.get("in_app_enabled", True):
                        return False
                
                # Check category-specific preferences
                categories = json.loads(prefs["categories"]) if prefs.get("categories") else {}
                if category in categories:
                    category_prefs = categories[category]
                    for channel in channels:
                        if not category_prefs.get(channel, True):
                            return False
                
                # Check quiet hours
                if prefs.get("quiet_hours_start") and prefs.get("quiet_hours_end"):
                    # Simplified quiet hours check (would need proper timezone handling in production)
                    current_hour = datetime.utcnow().hour
                    quiet_start = int(prefs["quiet_hours_start"].split(":")[0])
                    quiet_end = int(prefs["quiet_hours_end"].split(":")[0])
                    
                    if quiet_start <= current_hour < quiet_end:
                        # Only allow urgent/critical notifications during quiet hours
                        return category in [NotificationCategory.SECURITY_ALERT.value, NotificationCategory.SYSTEM_ALERT.value]
                
                return True
                
        except Exception as e:
            logger.error(f"Failed to check user preferences: {e}")
            return True  # Default to allow on error
    
    async def _send_in_app(self, recipient: NotificationRecipient, subject: str, message: str, variables: Dict[str, Any]) -> bool:
        """Send in-app notification via WebSocket"""
        try:
            notification_data = {
                "type": "notification",
                "subject": subject,
                "message": message,
                "timestamp": datetime.utcnow().isoformat(),
                "variables": variables
            }
            
            await connection_manager.send_personal_message(recipient.user_id, notification_data)
            
            # Also store in database for offline users
            async with db_manager.pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO in_app_notifications (user_id, subject, message, variables, created_at, read)
                    VALUES ($1, $2, $3, $4, $5, $6)
                """, recipient.user_id, subject, message, json.dumps(variables), datetime.utcnow(), False)
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to send in-app notification: {e}")
            return False
    
    async def _log_delivery_attempt(self, notification_id: str, user_id: str, channels: List[str], success: bool):
        """Log delivery attempt"""
        try:
            async with db_manager.pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO notification_delivery_log (
                        notification_id, user_id, channels, success, attempted_at
                    )
                    VALUES ($1, $2, $3, $4, $5)
                """, notification_id, user_id, json.dumps(channels), success, datetime.utcnow())
        except Exception as e:
            logger.error(f"Failed to log delivery attempt: {e}")

notification_service = NotificationService()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await db_manager.connect()
    await initialize_database()
    yield
    # Shutdown
    await db_manager.disconnect()

# FastAPI app
setup_telemetry(service_name="notification-service", service_version="1.0.0")
app = FastAPI(
instrument_fastapi(app)

app.middleware("http")(security_headers_middleware)
    title="Healthcare Claims Platform - Notification Service",
    description="Multi-channel communication, real-time alerts, and notification management",
    version="1.0.0",
    lifespan=lifespan
)

# Add middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def initialize_database():
    """Initialize database tables"""
    async with db_manager.pool.acquire() as conn:
        # Create notifications table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                category VARCHAR(50) NOT NULL,
                priority VARCHAR(20) NOT NULL,
                channels JSONB NOT NULL,
                subject TEXT,
                message TEXT NOT NULL,
                html_content TEXT,
                variables JSONB,
                attachments JSONB,
                scheduled_at TIMESTAMP,
                expires_at TIMESTAMP,
                tenant_id UUID,
                recipients_count INTEGER DEFAULT 0,
                sent_count INTEGER DEFAULT 0,
                delivered_count INTEGER DEFAULT 0,
                failed_count INTEGER DEFAULT 0,
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW(),
                sent_at TIMESTAMP,
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Create notification recipients table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS notification_recipients (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                notification_id UUID REFERENCES notifications(id) ON DELETE CASCADE,
                user_id UUID NOT NULL,
                email VARCHAR(255),
                phone VARCHAR(20),
                push_token TEXT,
                webhook_url TEXT,
                preferences JSONB
            )
        """)
        
        # Create notification templates table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS notification_templates (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL,
                category VARCHAR(50) NOT NULL,
                subject_template TEXT,
                body_template TEXT NOT NULL,
                html_template TEXT,
                sms_template TEXT,
                push_template TEXT,
                variables JSONB,
                active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Create notification preferences table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS notification_preferences (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID UNIQUE NOT NULL,
                email_enabled BOOLEAN DEFAULT true,
                sms_enabled BOOLEAN DEFAULT true,
                push_enabled BOOLEAN DEFAULT true,
                in_app_enabled BOOLEAN DEFAULT true,
                categories JSONB,
                quiet_hours_start TIME,
                quiet_hours_end TIME,
                timezone VARCHAR(50) DEFAULT 'UTC',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Create in-app notifications table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS in_app_notifications (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                subject TEXT,
                message TEXT NOT NULL,
                variables JSONB,
                read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW(),
                read_at TIMESTAMP
            )
        """)
        
        # Create delivery log table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS notification_delivery_log (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                notification_id UUID REFERENCES notifications(id) ON DELETE CASCADE,
                user_id UUID NOT NULL,
                channels JSONB,
                success BOOLEAN NOT NULL,
                error_message TEXT,
                attempted_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Insert default templates
        await conn.execute("""
            INSERT INTO notification_templates (name, category, subject_template, body_template, html_template)
            VALUES 
                ('Claim Status Update', 'claim_update', 'Claim {{claim_number}} Status Update', 
                 'Your claim {{claim_number}} status has been updated to {{status}}.', 
                 '<p>Your claim <strong>{{claim_number}}</strong> status has been updated to <strong>{{status}}</strong>.</p>'),
                ('Payment Notification', 'payment_notification', 'Payment Processed - {{amount}}',
                 'A payment of {{amount}} has been processed for claim {{claim_number}}.', 
                 '<p>A payment of <strong>{{amount}}</strong> has been processed for claim <strong>{{claim_number}}</strong>.</p>'),
                ('Welcome Message', 'welcome', 'Welcome to Healthcare Claims Platform',
                 'Welcome {{user_name}}! Your account has been created successfully.',
                 '<h2>Welcome {{user_name}}!</h2><p>Your account has been created successfully.</p>')
            ON CONFLICT DO NOTHING
        """)
        
        logger.info("Notification service database tables initialized")

# API Endpoints
@app.post("/notifications", response_model=NotificationResponse)
async def send_notification(request: NotificationRequest, background_tasks: BackgroundTasks,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Send notification to recipients"""
    return await notification_service.send_notification(request, background_tasks)

@app.get("/notifications/{notification_id}")
async def get_notification(notification_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get notification details"""
    async with db_manager.pool.acquire() as conn:
        notification = await conn.fetchrow("""
            SELECT * FROM notifications WHERE id = $1
        """, notification_id)
        
        if not notification:
            raise HTTPException(status_code=404, detail="Notification not found")
        
        return dict(notification)

@app.get("/notifications")
async def list_notifications(
    tenant_id: Optional[str] = None,
    category: Optional[NotificationCategory] = None,
    status: Optional[NotificationStatus] = None,
    limit: int = 50,
    offset: int = 0
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """List notifications with filtering"""
    async with db_manager.pool.acquire() as conn:
        query = "SELECT * FROM notifications WHERE 1=1"
        params = []
        param_count = 0
        
        if tenant_id:
            param_count += 1
            query += f" AND tenant_id = ${param_count}"
            params.append(tenant_id)
        
        if category:
            param_count += 1
            query += f" AND category = ${param_count}"
            params.append(category.value)
        
        if status:
            param_count += 1
            query += f" AND status = ${param_count}"
            params.append(status.value)
        
        query += f" ORDER BY created_at DESC LIMIT ${param_count + 1} OFFSET ${param_count + 2}"
        params.extend([limit, offset])
        
        notifications = await conn.fetch(query, *params)
        
        return {
            "notifications": [dict(notif) for notif in notifications],
            "total": len(notifications),
            "limit": limit,
            "offset": offset
        }

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str, tenant_id: Optional[str] = None):
    """WebSocket endpoint for real-time notifications"""
    await connection_manager.connect(websocket, user_id, tenant_id)
    
    try:
        # Send any unread in-app notifications
        async with db_manager.pool.acquire() as conn:
            unread = await conn.fetch("""
                SELECT * FROM in_app_notifications 
                WHERE user_id = $1 AND read = false 
                ORDER BY created_at DESC
            """, user_id)
            
            for notification in unread:
                await websocket.send_json({
                    "type": "notification",
                    "id": notification["id"],
                    "subject": notification["subject"],
                    "message": notification["message"],
                    "variables": json.loads(notification["variables"]) if notification["variables"] else {},
                    "timestamp": notification["created_at"].isoformat()
                })
        
        # Keep connection alive
        while True:
            data = await websocket.receive_text()
            # Handle client messages (like marking notifications as read)
            try:
                message = json.loads(data)
                if message.get("type") == "mark_read" and message.get("notification_id"):
                    async with db_manager.pool.acquire() as conn:
                        await conn.execute("""
                            UPDATE in_app_notifications 
                            SET read = true, read_at = NOW() 
                            WHERE id = $1 AND user_id = $2
                        """, message["notification_id"], user_id)
            except json.JSONDecodeError:
                logger.warning("Invalid JSON in notification message; skipping")
            
    except WebSocketDisconnect:
        connection_manager.disconnect(user_id, websocket)

@app.post("/preferences/{user_id}")
async def update_preferences(user_id: str, preferences: NotificationPreferences,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Update user notification preferences"""
    async with db_manager.pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO notification_preferences (
                user_id, email_enabled, sms_enabled, push_enabled, in_app_enabled,
                categories, quiet_hours_start, quiet_hours_end, timezone, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (user_id) DO UPDATE SET
                email_enabled = $2, sms_enabled = $3, push_enabled = $4, in_app_enabled = $5,
                categories = $6, quiet_hours_start = $7, quiet_hours_end = $8, timezone = $9, updated_at = $10
        """, 
            user_id, preferences.email_enabled, preferences.sms_enabled, 
            preferences.push_enabled, preferences.in_app_enabled,
            json.dumps({k.value: v for k, v in preferences.categories.items()}),
            preferences.quiet_hours_start, preferences.quiet_hours_end, 
            preferences.timezone, datetime.utcnow()
        )
    
    return {"message": "Preferences updated successfully"}

@app.get("/preferences/{user_id}")
async def get_preferences(user_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get user notification preferences"""
    async with db_manager.pool.acquire() as conn:
        prefs = await conn.fetchrow("""
            SELECT * FROM notification_preferences WHERE user_id = $1
        """, user_id)
        
        if not prefs:
            # Return default preferences
            return {
                "user_id": user_id,
                "email_enabled": True,
                "sms_enabled": True,
                "push_enabled": True,
                "in_app_enabled": True,
                "categories": {},
                "quiet_hours_start": None,
                "quiet_hours_end": None,
                "timezone": "UTC"
            }
        
        return dict(prefs)

@app.get("/templates")
async def list_templates(,
    current_user: TokenPayload = Depends(get_current_user),
):
    """List notification templates"""
    async with db_manager.pool.acquire() as conn:
        templates = await conn.fetch("""
            SELECT * FROM notification_templates WHERE active = true ORDER BY name
        """)
        
        return {"templates": [dict(template) for template in templates]}

@app.get("/stats")
async def get_notification_stats(,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get notification statistics"""
    async with db_manager.pool.acquire() as conn:
        stats = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total_notifications,
                COUNT(*) FILTER (WHERE status = 'sent') as sent_notifications,
                COUNT(*) FILTER (WHERE status = 'failed') as failed_notifications,
                COUNT(*) FILTER (WHERE status = 'pending') as pending_notifications,
                AVG(sent_count::float / NULLIF(recipients_count, 0)) as avg_delivery_rate
            FROM notifications
            WHERE created_at > NOW() - INTERVAL '30 days'
        """)
        
        return {
            "total_notifications": stats["total_notifications"],
            "sent_notifications": stats["sent_notifications"],
            "failed_notifications": stats["failed_notifications"],
            "pending_notifications": stats["pending_notifications"],
            "delivery_rate": float(stats["avg_delivery_rate"] or 0) * 100,
            "active_connections": len(connection_manager.active_connections)
        }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        async with db_manager.pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        
        await db_manager.redis.ping()
        
        return {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "service": "notification-service",
            "version": "1.0.0",
            "active_connections": len(connection_manager.active_connections)
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service unhealthy"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8007)