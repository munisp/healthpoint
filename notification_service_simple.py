#!/usr/bin/env python3
"""
Healthcare Claims Platform - Simplified Notification Service
Basic notification service without Redis dependency for testing.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime
import uuid
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Pydantic Models
class NotificationRequest(BaseModel):
    recipient: EmailStr
    subject: str
    message: str
    channel: str = "email"  # email, sms, push, in_app
    priority: str = "normal"  # low, normal, high, urgent

class NotificationResponse(BaseModel):
    id: str
    status: str
    message: str

# In-memory storage for testing
notifications_db = {}

# FastAPI app
app = FastAPI(
    title="Healthcare Claims Platform - Notification Service",
    description="Simplified notification service for testing",
    version="1.0.0"
)

# Add middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/send", response_model=NotificationResponse)
async def send_notification(notification: NotificationRequest):
    """Send notification"""
    try:
        notification_id = str(uuid.uuid4())
        
        # Simulate notification sending
        notification_record = {
            "id": notification_id,
            "recipient": notification.recipient,
            "subject": notification.subject,
            "message": notification.message,
            "channel": notification.channel,
            "priority": notification.priority,
            "status": "sent",
            "created_at": datetime.utcnow().isoformat(),
            "sent_at": datetime.utcnow().isoformat()
        }
        
        notifications_db[notification_id] = notification_record
        
        logger.info(f"Notification sent: {notification_id} to {notification.recipient}")
        
        return NotificationResponse(
            id=notification_id,
            status="sent",
            message="Notification sent successfully"
        )
        
    except Exception as e:
        logger.error(f"Failed to send notification: {e}")
        raise HTTPException(status_code=500, detail="Failed to send notification")

@app.get("/notifications/{notification_id}")
async def get_notification(notification_id: str):
    """Get notification by ID"""
    try:
        notification = notifications_db.get(notification_id)
        if not notification:
            raise HTTPException(status_code=404, detail="Notification not found")
        
        return notification
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get notification: {e}")
        raise HTTPException(status_code=500, detail="Failed to get notification")

@app.get("/notifications")
async def list_notifications(limit: int = 100, offset: int = 0):
    """List notifications"""
    try:
        notifications = list(notifications_db.values())
        notifications.sort(key=lambda x: x["created_at"], reverse=True)
        
        return {
            "notifications": notifications[offset:offset+limit],
            "total": len(notifications),
            "limit": limit,
            "offset": offset
        }
        
    except Exception as e:
        logger.error(f"Failed to list notifications: {e}")
        raise HTTPException(status_code=500, detail="Failed to list notifications")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "notification-service",
        "version": "1.0.0",
        "notifications_count": len(notifications_db)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8006)
