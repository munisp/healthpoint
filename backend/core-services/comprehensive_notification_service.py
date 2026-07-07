"""
Comprehensive Notification Service for NSA/IDR Healthcare Platform
Handles all major platform events with multi-channel notifications
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

from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import asyncio
import smtplib
import json
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import redis.asyncio as redis
import requests
from twilio.rest import Client
import websockets
from jinja2 import Template

app = FastAPI(title="Comprehensive Notification Service", version="1.0.0")

app.middleware("http")(security_headers_middleware)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Redis connection for real-time notifications
# Redis client initialized via shared cache module
# Use: from backend.shared.cache import get_client as get_redis_client

class NotificationChannel(str, Enum):
    EMAIL = "email"
    SMS = "sms"
    PUSH = "push"
    WEBSOCKET = "websocket"
    SLACK = "slack"
    TEAMS = "teams"

class NotificationPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class EventType(str, Enum):
    # Bulk Upload Events
    BULK_UPLOAD_STARTED = "bulk_upload_started"
    BULK_UPLOAD_VALIDATION_COMPLETE = "bulk_upload_validation_complete"
    BULK_UPLOAD_PROCESSING = "bulk_upload_processing"
    BULK_UPLOAD_COMPLETE = "bulk_upload_complete"
    BULK_UPLOAD_ERROR = "bulk_upload_error"
    
    # Payment & Refund Events
    PAYMENT_PROCESSED = "payment_processed"
    PAYMENT_FAILED = "payment_failed"
    REFUND_INITIATED = "refund_initiated"
    REFUND_COMPLETE = "refund_complete"
    REFUND_FAILED = "refund_failed"
    BILLING_GENERATED = "billing_generated"
    
    # Provider Management Events
    PROVIDER_ADDED = "provider_added"
    PROVIDER_VERIFIED = "provider_verified"
    PROVIDER_VERIFICATION_FAILED = "provider_verification_failed"
    AGGREGATOR_ASSIGNED = "aggregator_assigned"
    PAYMENT_DETAILS_UPDATED = "payment_details_updated"
    
    # NSA/IDR Dispute Events
    DISPUTE_SUBMITTED = "dispute_submitted"
    DISPUTE_ACCEPTED = "dispute_accepted"
    DISPUTE_REJECTED = "dispute_rejected"
    DISPUTE_UNDER_REVIEW = "dispute_under_review"
    DISPUTE_DECISION_RECEIVED = "dispute_decision_received"
    
    # System Events
    SYSTEM_MAINTENANCE = "system_maintenance"
    SECURITY_ALERT = "security_alert"
    COMPLIANCE_ALERT = "compliance_alert"
    API_RATE_LIMIT = "api_rate_limit"
    SERVICE_DOWN = "service_down"
    SERVICE_RESTORED = "service_restored"

class NotificationRequest(BaseModel):
    event_type: EventType
    recipient_id: str
    channels: List[NotificationChannel]
    priority: NotificationPriority = NotificationPriority.MEDIUM
    data: Dict[str, Any]
    scheduled_time: Optional[datetime] = None
    expires_at: Optional[datetime] = None

class NotificationTemplate(BaseModel):
    event_type: EventType
    channel: NotificationChannel
    subject_template: str
    body_template: str
    variables: List[str]

class NotificationPreference(BaseModel):
    user_id: str
    event_types: List[EventType]
    channels: List[NotificationChannel]
    quiet_hours_start: Optional[str] = None
    quiet_hours_end: Optional[str] = None
    timezone: str = "UTC"

class ComprehensiveNotificationService:
    def __init__(self):
        self.templates = self._load_notification_templates()
        self.user_preferences = {}
        self.notification_history = []
        
    def _load_notification_templates(self) -> Dict[str, Dict[str, NotificationTemplate]]:
        """Load notification templates for all event types and channels"""
        templates = {
            # Bulk Upload Templates
            EventType.BULK_UPLOAD_STARTED: {
                NotificationChannel.EMAIL: NotificationTemplate(
                    event_type=EventType.BULK_UPLOAD_STARTED,
                    channel=NotificationChannel.EMAIL,
                    subject_template="NSA/IDR Bulk Upload Started - {{batch_id}}",
                    body_template="""
                    <h2>Bulk Upload Processing Started</h2>
                    <p>Your NSA/IDR dispute claims bulk upload has been initiated.</p>
                    <ul>
                        <li><strong>Batch ID:</strong> {{batch_id}}</li>
                        <li><strong>Total Records:</strong> {{total_records}}</li>
                        <li><strong>Aggregator:</strong> {{aggregator_name}}</li>
                        <li><strong>Started At:</strong> {{started_at}}</li>
                    </ul>
                    <p>You will receive updates as the processing progresses.</p>
                    """,
                    variables=["batch_id", "total_records", "aggregator_name", "started_at"]
                ),
                NotificationChannel.SMS: NotificationTemplate(
                    event_type=EventType.BULK_UPLOAD_STARTED,
                    channel=NotificationChannel.SMS,
                    subject_template="",
                    body_template="NSA/IDR Bulk Upload {{batch_id}} started. {{total_records}} records processing for {{aggregator_name}}.",
                    variables=["batch_id", "total_records", "aggregator_name"]
                )
            },
            
            EventType.BULK_UPLOAD_COMPLETE: {
                NotificationChannel.EMAIL: NotificationTemplate(
                    event_type=EventType.BULK_UPLOAD_COMPLETE,
                    channel=NotificationChannel.EMAIL,
                    subject_template="NSA/IDR Bulk Upload Complete - {{batch_id}}",
                    body_template="""
                    <h2>Bulk Upload Processing Complete</h2>
                    <p>Your NSA/IDR dispute claims bulk upload has been completed successfully.</p>
                    <div style="background-color: #f0f8ff; padding: 15px; border-radius: 5px;">
                        <h3>Processing Summary</h3>
                        <ul>
                            <li><strong>Batch ID:</strong> {{batch_id}}</li>
                            <li><strong>Total Records:</strong> {{total_records}}</li>
                            <li><strong>Valid Records:</strong> {{valid_records}}</li>
                            <li><strong>Invalid Records:</strong> {{invalid_records}}</li>
                            <li><strong>Success Rate:</strong> {{success_rate}}%</li>
                        </ul>
                    </div>
                    <p><strong>CMS Submission ID:</strong> {{cms_submission_id}}</p>
                    <p>All valid claims have been submitted to the CMS IDR Portal.</p>
                    """,
                    variables=["batch_id", "total_records", "valid_records", "invalid_records", "success_rate", "cms_submission_id"]
                )
            },
            
            # Payment & Refund Templates
            EventType.REFUND_COMPLETE: {
                NotificationChannel.EMAIL: NotificationTemplate(
                    event_type=EventType.REFUND_COMPLETE,
                    channel=NotificationChannel.EMAIL,
                    subject_template="NSA/IDR Refund Processed - ${{refund_amount}}",
                    body_template="""
                    <h2>NSA/IDR Refund Processed Successfully</h2>
                    <p>A refund has been processed for your NSA/IDR dispute claim.</p>
                    <div style="background-color: #f0fff0; padding: 15px; border-radius: 5px;">
                        <h3>Refund Details</h3>
                        <ul>
                            <li><strong>Refund Amount:</strong> ${{refund_amount}}</li>
                            <li><strong>Dispute ID:</strong> {{dispute_id}}</li>
                            <li><strong>Provider:</strong> {{provider_name}}</li>
                            <li><strong>Refund Method:</strong> {{refund_method}}</li>
                            <li><strong>Processing Date:</strong> {{processing_date}}</li>
                        </ul>
                    </div>
                    <p>The refund will appear in your account within 3-5 business days.</p>
                    """,
                    variables=["refund_amount", "dispute_id", "provider_name", "refund_method", "processing_date"]
                )
            },
            
            # Provider Management Templates
            EventType.PROVIDER_VERIFIED: {
                NotificationChannel.EMAIL: NotificationTemplate(
                    event_type=EventType.PROVIDER_VERIFIED,
                    channel=NotificationChannel.EMAIL,
                    subject_template="Provider Verification Complete - {{provider_name}}",
                    body_template="""
                    <h2>Provider Verification Successful</h2>
                    <p>The provider has been successfully verified and added to your aggregator.</p>
                    <div style="background-color: #f0fff0; padding: 15px; border-radius: 5px;">
                        <h3>Provider Details</h3>
                        <ul>
                            <li><strong>Provider Name:</strong> {{provider_name}}</li>
                            <li><strong>NPI:</strong> {{provider_npi}}</li>
                            <li><strong>Specialty:</strong> {{specialty}}</li>
                            <li><strong>Aggregator:</strong> {{aggregator_name}}</li>
                            <li><strong>Billing Plan:</strong> {{billing_plan}}</li>
                        </ul>
                    </div>
                    <p>The provider can now submit NSA/IDR dispute claims through your aggregator.</p>
                    """,
                    variables=["provider_name", "provider_npi", "specialty", "aggregator_name", "billing_plan"]
                )
            },
            
            # Security & System Templates
            EventType.SECURITY_ALERT: {
                NotificationChannel.EMAIL: NotificationTemplate(
                    event_type=EventType.SECURITY_ALERT,
                    channel=NotificationChannel.EMAIL,
                    subject_template="🚨 Security Alert - {{alert_type}}",
                    body_template="""
                    <h2 style="color: #d32f2f;">🚨 Security Alert</h2>
                    <p><strong>Alert Type:</strong> {{alert_type}}</p>
                    <p><strong>Severity:</strong> {{severity}}</p>
                    <p><strong>Description:</strong> {{description}}</p>
                    <p><strong>Affected Resource:</strong> {{affected_resource}}</p>
                    <p><strong>Timestamp:</strong> {{timestamp}}</p>
                    
                    <div style="background-color: #ffebee; padding: 15px; border-radius: 5px; border-left: 4px solid #d32f2f;">
                        <h3>Recommended Actions</h3>
                        <ul>
                            {{#recommended_actions}}
                            <li>{{.}}</li>
                            {{/recommended_actions}}
                        </ul>
                    </div>
                    
                    <p>Please take immediate action to secure your system.</p>
                    """,
                    variables=["alert_type", "severity", "description", "affected_resource", "timestamp", "recommended_actions"]
                )
            }
        }
        return templates

    async def send_notification(self, notification: NotificationRequest) -> Dict[str, Any]:
        """Send notification through specified channels"""
        results = {}
        
        # Check user preferences
        if notification.recipient_id in self.user_preferences:
            prefs = self.user_preferences[notification.recipient_id]
            # Filter channels based on user preferences
            notification.channels = [ch for ch in notification.channels if ch in prefs.channels]
            # Check if event type is enabled
            if notification.event_type not in prefs.event_types:
                return {"status": "skipped", "reason": "Event type disabled by user"}
        
        # Check quiet hours
        if self._is_quiet_hours(notification.recipient_id):
            if notification.priority not in [NotificationPriority.HIGH, NotificationPriority.CRITICAL]:
                # Schedule for later
                return await self._schedule_notification(notification)
        
        # Send through each channel
        for channel in notification.channels:
            try:
                if channel == NotificationChannel.EMAIL:
                    result = await self._send_email(notification)
                elif channel == NotificationChannel.SMS:
                    result = await self._send_sms(notification)
                elif channel == NotificationChannel.PUSH:
                    result = await self._send_push(notification)
                elif channel == NotificationChannel.WEBSOCKET:
                    result = await self._send_websocket(notification)
                elif channel == NotificationChannel.SLACK:
                    result = await self._send_slack(notification)
                elif channel == NotificationChannel.TEAMS:
                    result = await self._send_teams(notification)
                
                results[channel.value] = result
                
            except Exception as e:
                logger.error(f"Failed to send {channel} notification: {str(e)}")
                results[channel.value] = {"status": "failed", "error": str(e)}
        
        # Store notification history
        self._store_notification_history(notification, results)
        
        return {
            "notification_id": f"notif_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            "status": "processed",
            "results": results
        }

    async def _send_email(self, notification: NotificationRequest) -> Dict[str, Any]:
        """Send email notification"""
        template = self.templates.get(notification.event_type, {}).get(NotificationChannel.EMAIL)
        if not template:
            return {"status": "failed", "error": "Template not found"}
        
        # Render template
        subject = Template(template.subject_template).render(**notification.data)
        body = Template(template.body_template).render(**notification.data)
        
        # Email configuration (would be from environment variables)
        smtp_server = "smtp.gmail.com"
        smtp_port = 587
        smtp_user = "nsa-idr-platform@healthcare.com"
        smtp_password = os.environ["SMTP_PASSWORD"]
        
        try:
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = smtp_user
            msg['To'] = self._get_user_email(notification.recipient_id)
            
            html_part = MIMEText(body, 'html')
            msg.attach(html_part)
            
            with smtplib.SMTP(smtp_server, smtp_port) as server:
                server.starttls()
                server.login(smtp_user, smtp_password)
                server.send_message(msg)
            
            return {"status": "sent", "timestamp": datetime.now().isoformat()}
            
        except Exception as e:
            return {"status": "failed", "error": str(e)}

    async def _send_sms(self, notification: NotificationRequest) -> Dict[str, Any]:
        """Send SMS notification"""
        template = self.templates.get(notification.event_type, {}).get(NotificationChannel.SMS)
        if not template:
            return {"status": "failed", "error": "Template not found"}
        
        # Render template
        message = Template(template.body_template).render(**notification.data)
        
        # Twilio configuration (would be from environment variables)
        account_sid = os.environ["TWILIO_ACCOUNT_SID"]
        auth_token = os.environ["TWILIO_AUTH_TOKEN"]
        from_number = "+1234567890"
        
        try:
            client = Client(account_sid, auth_token)
            
            message = client.messages.create(
                body=message,
                from_=from_number,
                to=self._get_user_phone(notification.recipient_id)
            )
            
            return {"status": "sent", "message_sid": message.sid, "timestamp": datetime.now().isoformat()}
            
        except Exception as e:
            return {"status": "failed", "error": str(e)}

    async def _send_websocket(self, notification: NotificationRequest) -> Dict[str, Any]:
        """Send real-time WebSocket notification"""
        try:
            # Publish to Redis for WebSocket subscribers
            message = {
                "event_type": notification.event_type,
                "recipient_id": notification.recipient_id,
                "priority": notification.priority,
                "data": notification.data,
                "timestamp": datetime.now().isoformat()
            }
            
            redis_client.publish(f"notifications:{notification.recipient_id}", json.dumps(message))
            
            return {"status": "sent", "timestamp": datetime.now().isoformat()}
            
        except Exception as e:
            return {"status": "failed", "error": str(e)}

    async def _send_slack(self, notification: NotificationRequest) -> Dict[str, Any]:
        """Send Slack notification"""
        try:
            webhook_url = self._get_slack_webhook(notification.recipient_id)
            
            # Format message for Slack
            message = {
                "text": f"NSA/IDR Platform Notification",
                "attachments": [
                    {
                        "color": self._get_priority_color(notification.priority),
                        "fields": [
                            {"title": "Event", "value": notification.event_type, "short": True},
                            {"title": "Priority", "value": notification.priority, "short": True}
                        ],
                        "text": self._format_slack_message(notification)
                    }
                ]
            }
            
            response = requests.post(webhook_url, json=message)
            
            if response.status_code == 200:
                return {"status": "sent", "timestamp": datetime.now().isoformat()}
            else:
                return {"status": "failed", "error": f"HTTP {response.status_code}"}
                
        except Exception as e:
            return {"status": "failed", "error": str(e)}

    def _is_quiet_hours(self, user_id: str) -> bool:
        """Check if current time is within user's quiet hours"""
        if user_id not in self.user_preferences:
            return False
        
        prefs = self.user_preferences[user_id]
        if not prefs.quiet_hours_start or not prefs.quiet_hours_end:
            return False
        
        # Implementation would check current time against quiet hours
        # This is a simplified version
        return False

    def _get_user_email(self, user_id: str) -> str:
        """Get user email address"""
        # This would query the user database
        return f"user_{user_id}@healthcare.com"

    def _get_user_phone(self, user_id: str) -> str:
        """Get user phone number"""
        # This would query the user database
        return "+1234567890"

    def _get_slack_webhook(self, user_id: str) -> str:
        """Get user's Slack webhook URL"""
        # This would query the user preferences
        return "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"

    def _get_priority_color(self, priority: NotificationPriority) -> str:
        """Get color code for priority level"""
        colors = {
            NotificationPriority.LOW: "#36a64f",
            NotificationPriority.MEDIUM: "#ff9500",
            NotificationPriority.HIGH: "#ff4444",
            NotificationPriority.CRITICAL: "#990000"
        }
        return colors.get(priority, "#36a64f")

    def _format_slack_message(self, notification: NotificationRequest) -> str:
        """Format notification data for Slack"""
        # This would format the notification data appropriately for Slack
        return f"Event: {notification.event_type}\nData: {json.dumps(notification.data, indent=2)}"

    def _store_notification_history(self, notification: NotificationRequest, results: Dict[str, Any]):
        """Store notification in history for audit purposes"""
        history_entry = {
            "timestamp": datetime.now().isoformat(),
            "event_type": notification.event_type,
            "recipient_id": notification.recipient_id,
            "channels": [ch.value for ch in notification.channels],
            "priority": notification.priority,
            "results": results
        }
        self.notification_history.append(history_entry)

    async def _schedule_notification(self, notification: NotificationRequest) -> Dict[str, Any]:
        """Schedule notification for later delivery"""
        # This would use a task queue like Celery or Redis Queue
        return {"status": "scheduled", "reason": "Quiet hours"}

# Initialize service
notification_service = ComprehensiveNotificationService()

# API Endpoints
@app.post("/notifications/send")
async def send_notification(notification: NotificationRequest, background_tasks: BackgroundTasks,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Send a notification"""
    try:
        result = await notification_service.send_notification(notification)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/notifications/bulk-upload-started")
async def notify_bulk_upload_started(
    batch_id: str,
    aggregator_id: str,
    total_records: int,
    background_tasks: BackgroundTasks
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Notify when bulk upload starts"""
    notification = NotificationRequest(
        event_type=EventType.BULK_UPLOAD_STARTED,
        recipient_id=aggregator_id,
        channels=[NotificationChannel.EMAIL, NotificationChannel.WEBSOCKET],
        priority=NotificationPriority.MEDIUM,
        data={
            "batch_id": batch_id,
            "total_records": total_records,
            "aggregator_name": f"Aggregator {aggregator_id}",
            "started_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
    )
    
    background_tasks.add_task(notification_service.send_notification, notification)
    return {"status": "notification_queued"}

@app.post("/notifications/bulk-upload-complete")
async def notify_bulk_upload_complete(
    batch_id: str,
    aggregator_id: str,
    total_records: int,
    valid_records: int,
    invalid_records: int,
    cms_submission_id: str,
    background_tasks: BackgroundTasks
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Notify when bulk upload completes"""
    success_rate = round((valid_records / total_records) * 100, 1) if total_records > 0 else 0
    
    notification = NotificationRequest(
        event_type=EventType.BULK_UPLOAD_COMPLETE,
        recipient_id=aggregator_id,
        channels=[NotificationChannel.EMAIL, NotificationChannel.SMS, NotificationChannel.WEBSOCKET],
        priority=NotificationPriority.HIGH,
        data={
            "batch_id": batch_id,
            "total_records": total_records,
            "valid_records": valid_records,
            "invalid_records": invalid_records,
            "success_rate": success_rate,
            "cms_submission_id": cms_submission_id
        }
    )
    
    background_tasks.add_task(notification_service.send_notification, notification)
    return {"status": "notification_queued"}

@app.post("/notifications/refund-complete")
async def notify_refund_complete(
    dispute_id: str,
    provider_id: str,
    refund_amount: float,
    refund_method: str,
    background_tasks: BackgroundTasks
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Notify when refund is complete"""
    notification = NotificationRequest(
        event_type=EventType.REFUND_COMPLETE,
        recipient_id=provider_id,
        channels=[NotificationChannel.EMAIL, NotificationChannel.SMS],
        priority=NotificationPriority.HIGH,
        data={
            "dispute_id": dispute_id,
            "provider_name": f"Provider {provider_id}",
            "refund_amount": f"{refund_amount:,.2f}",
            "refund_method": refund_method,
            "processing_date": datetime.now().strftime("%Y-%m-%d")
        }
    )
    
    background_tasks.add_task(notification_service.send_notification, notification)
    return {"status": "notification_queued"}

@app.post("/notifications/security-alert")
async def notify_security_alert(
    alert_type: str,
    severity: str,
    description: str,
    affected_resource: str,
    recommended_actions: List[str],
    background_tasks: BackgroundTasks
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Send security alert notification"""
    notification = NotificationRequest(
        event_type=EventType.SECURITY_ALERT,
        recipient_id="admin",  # Send to all admins
        channels=[NotificationChannel.EMAIL, NotificationChannel.SLACK, NotificationChannel.SMS],
        priority=NotificationPriority.CRITICAL,
        data={
            "alert_type": alert_type,
            "severity": severity,
            "description": description,
            "affected_resource": affected_resource,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "recommended_actions": recommended_actions
        }
    )
    
    background_tasks.add_task(notification_service.send_notification, notification)
    return {"status": "security_alert_sent"}

@app.get("/notifications/history/{user_id}")
async def get_notification_history(user_id: str, limit: int = 50,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get notification history for a user"""
    user_history = [
        entry for entry in notification_service.notification_history
        if entry["recipient_id"] == user_id
    ]
    return {"history": user_history[-limit:]}

@app.post("/notifications/preferences")
async def set_notification_preferences(preferences: NotificationPreference,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Set user notification preferences"""
    notification_service.user_preferences[preferences.user_id] = preferences
    return {"status": "preferences_updated"}

@app.get("/notifications/templates")
async def get_notification_templates(
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get available notification templates"""
    template_info = {}
    for event_type, channels in notification_service.templates.items():
        template_info[event_type] = {
            channel: {
                "subject_template": template.subject_template,
                "variables": template.variables
            }
            for channel, template in channels.items()
        }
    return {"templates": template_info}


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    from datetime import datetime
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8023)