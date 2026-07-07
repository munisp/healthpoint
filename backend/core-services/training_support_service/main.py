"""
Training & Support Service
Comprehensive learning management and support system for healthcare providers
Port: 8024
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

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import uuid
import json
import asyncio
from sqlalchemy import create_engine, Column, String, DateTime, Boolean, Integer, Text, Float
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
import logging
from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

setup_telemetry(service_name="training-support-service", service_version="1.0.0")
app = FastAPI(
    title="Training & Support Service",
    description="Comprehensive learning management and support system for healthcare providers",
    version="1.0.0"
)
instrument_fastapi(app)
app.middleware("http")(security_headers_middleware)


# Enums
class CourseStatus(str, Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"

class EnrollmentStatus(str, Enum):
    ENROLLED = "enrolled"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    EXPIRED = "expired"

class SupportTicketStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"

class SupportTicketPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class ContentType(str, Enum):
    VIDEO = "video"
    DOCUMENT = "document"
    INTERACTIVE = "interactive"
    QUIZ = "quiz"
    WEBINAR = "webinar"

# Data Models
class Course(BaseModel):
    course_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: str
    category: str
    difficulty_level: str = "beginner"  # beginner, intermediate, advanced
    estimated_duration_hours: float
    prerequisites: List[str] = []
    learning_objectives: List[str] = []
    status: CourseStatus = CourseStatus.DRAFT
    created_by: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    is_mandatory: bool = False
    expiration_days: Optional[int] = None
    passing_score: float = 80.0
    tags: List[str] = []

class CourseModule(BaseModel):
    module_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    course_id: str
    title: str
    description: str
    order_index: int
    content_type: ContentType
    content_url: Optional[str] = None
    content_data: Optional[Dict[str, Any]] = None
    duration_minutes: int
    is_required: bool = True

class Quiz(BaseModel):
    quiz_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    course_id: str
    module_id: Optional[str] = None
    title: str
    description: str
    questions: List[Dict[str, Any]] = []
    passing_score: float = 80.0
    time_limit_minutes: Optional[int] = None
    attempts_allowed: int = 3

class Enrollment(BaseModel):
    enrollment_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    course_id: str
    enrolled_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    status: EnrollmentStatus = EnrollmentStatus.ENROLLED
    progress_percentage: float = 0.0
    current_module_id: Optional[str] = None
    score: Optional[float] = None
    attempts: int = 0
    expires_at: Optional[datetime] = None

class Certification(BaseModel):
    certification_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    course_id: str
    issued_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: Optional[datetime] = None
    certificate_url: str
    verification_code: str = Field(default_factory=lambda: str(uuid.uuid4())[:8].upper())
    is_valid: bool = True

class SupportTicket(BaseModel):
    ticket_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    subject: str
    description: str
    category: str
    priority: SupportTicketPriority = SupportTicketPriority.MEDIUM
    status: SupportTicketStatus = SupportTicketStatus.OPEN
    assigned_to: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    resolved_at: Optional[datetime] = None
    resolution: Optional[str] = None
    attachments: List[str] = []
    tags: List[str] = []

class KnowledgeBaseArticle(BaseModel):
    article_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    content: str
    category: str
    tags: List[str] = []
    author: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    view_count: int = 0
    helpful_votes: int = 0
    unhelpful_votes: int = 0
    is_published: bool = True

class Webinar(BaseModel):
    webinar_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: str
    presenter: str
    scheduled_at: datetime
    duration_minutes: int
    max_attendees: Optional[int] = None
    registration_required: bool = True
    webinar_url: str
    recording_url: Optional[str] = None
    materials: List[str] = []
    tags: List[str] = []

# In-memory storage (replace with database in production)
courses = {}
course_modules = {}
quizzes = {}
enrollments = {}
certifications = {}
support_tickets = {}
knowledge_base = {}
webinars = {}

# Training & Support Service
class TrainingAndSupportManager:
    def __init__(self):
        self.notification_service = None  # Initialize with notification service
        
    async def create_course(self, course: Course) -> Course:
        """Create a new training course"""
        courses[course.course_id] = course
        logger.info(f"Created course: {course.course_id}")
        return course
    
    async def add_course_module(self, module: CourseModule) -> CourseModule:
        """Add a module to a course"""
        if module.course_id not in courses:
            raise HTTPException(status_code=404, detail="Course not found")
        
        course_modules[module.module_id] = module
        logger.info(f"Added module {module.module_id} to course {module.course_id}")
        return module
    
    async def create_quiz(self, quiz: Quiz) -> Quiz:
        """Create a quiz for a course or module"""
        if quiz.course_id not in courses:
            raise HTTPException(status_code=404, detail="Course not found")
        
        quizzes[quiz.quiz_id] = quiz
        logger.info(f"Created quiz: {quiz.quiz_id}")
        return quiz
    
    async def enroll_user(self, user_id: str, course_id: str) -> Enrollment:
        """Enroll a user in a course"""
        if course_id not in courses:
            raise HTTPException(status_code=404, detail="Course not found")
        
        # Check if user is already enrolled
        existing_enrollment = next(
            (e for e in enrollments.values() if e.user_id == user_id and e.course_id == course_id),
            None
        )
        if existing_enrollment:
            raise HTTPException(status_code=400, detail="User already enrolled in this course")
        
        course = courses[course_id]
        enrollment = Enrollment(
            user_id=user_id,
            course_id=course_id,
            expires_at=datetime.utcnow() + timedelta(days=course.expiration_days) if course.expiration_days else None
        )
        
        enrollments[enrollment.enrollment_id] = enrollment
        logger.info(f"Enrolled user {user_id} in course {course_id}")
        return enrollment
    
    async def update_progress(self, enrollment_id: str, module_id: str, completed: bool = False) -> Enrollment:
        """Update user progress in a course"""
        if enrollment_id not in enrollments:
            raise HTTPException(status_code=404, detail="Enrollment not found")
        
        enrollment = enrollments[enrollment_id]
        enrollment.current_module_id = module_id
        enrollment.updated_at = datetime.utcnow()
        
        if enrollment.started_at is None:
            enrollment.started_at = datetime.utcnow()
            enrollment.status = EnrollmentStatus.IN_PROGRESS
        
        # Calculate progress
        course_modules_list = [m for m in course_modules.values() if m.course_id == enrollment.course_id]
        if course_modules_list:
            current_module_index = next(
                (i for i, m in enumerate(sorted(course_modules_list, key=lambda x: x.order_index)) if m.module_id == module_id),
                0
            )
            enrollment.progress_percentage = ((current_module_index + (1 if completed else 0.5)) / len(course_modules_list)) * 100
        
        # Check if course is completed
        if enrollment.progress_percentage >= 100:
            enrollment.status = EnrollmentStatus.COMPLETED
            enrollment.completed_at = datetime.utcnow()
            await self._issue_certificate(enrollment)
        
        logger.info("Updated progress for enrollment $1", enrollment_id)
        return enrollment
    
    async def submit_quiz(self, quiz_id: str, user_id: str, answers: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Submit quiz answers and calculate score"""
        if quiz_id not in quizzes:
            raise HTTPException(status_code=404, detail="Quiz not found")
        
        quiz = quizzes[quiz_id]
        
        # Find user's enrollment
        enrollment = next(
            (e for e in enrollments.values() if e.user_id == user_id and e.course_id == quiz.course_id),
            None
        )
        if not enrollment:
            raise HTTPException(status_code=404, detail="User not enrolled in this course")
        
        # Calculate score
        correct_answers = 0
        total_questions = len(quiz.questions)
        
        for i, answer in enumerate(answers):
            if i < len(quiz.questions):
                question = quiz.questions[i]
                if question.get("correct_answer") == answer.get("answer"):
                    correct_answers += 1
        
        score = (correct_answers / total_questions * 100) if total_questions > 0 else 0
        enrollment.score = score
        enrollment.attempts += 1
        
        # Check if passed
        passed = score >= quiz.passing_score
        if passed:
            enrollment.status = EnrollmentStatus.COMPLETED
            enrollment.completed_at = datetime.utcnow()
            await self._issue_certificate(enrollment)
        elif enrollment.attempts >= quiz.attempts_allowed:
            enrollment.status = EnrollmentStatus.FAILED
        
        result = {
            "quiz_id": quiz_id,
            "user_id": user_id,
            "score": score,
            "passed": passed,
            "correct_answers": correct_answers,
            "total_questions": total_questions,
            "attempts_used": enrollment.attempts,
            "attempts_remaining": max(0, quiz.attempts_allowed - enrollment.attempts)
        }
        
        logger.info(f"Quiz submitted: {quiz_id} by user {user_id}, score: {score}")
        return result
    
    async def _issue_certificate(self, enrollment: Enrollment):
        """Issue a certificate for completed course"""
        course = courses[enrollment.course_id]
        
        certificate = Certification(
            user_id=enrollment.user_id,
            course_id=enrollment.course_id,
            certificate_url=f"/certificates/{enrollment.user_id}/{enrollment.course_id}",
            expires_at=datetime.utcnow() + timedelta(days=365) if course.expiration_days else None
        )
        
        certifications[certificate.certification_id] = certificate
        logger.info(f"Issued certificate: {certificate.certification_id}")
        return certificate
    
    async def create_support_ticket(self, ticket: SupportTicket) -> SupportTicket:
        """Create a new support ticket"""
        support_tickets[ticket.ticket_id] = ticket
        
        # Auto-assign based on category (simplified logic)
        if ticket.category == "technical":
            ticket.assigned_to = "tech_support_team"
        elif ticket.category == "billing":
            ticket.assigned_to = "billing_team"
        else:
            ticket.assigned_to = "general_support"
        
        logger.info(f"Created support ticket: {ticket.ticket_id}")
        return ticket
    
    async def update_ticket_status(self, ticket_id: str, status: SupportTicketStatus, 
                                 resolution: Optional[str] = None) -> SupportTicket:
        """Update support ticket status"""
        if ticket_id not in support_tickets:
            raise HTTPException(status_code=404, detail="Ticket not found")
        
        ticket = support_tickets[ticket_id]
        ticket.status = status
        ticket.updated_at = datetime.utcnow()
        
        if status == SupportTicketStatus.RESOLVED and resolution:
            ticket.resolution = resolution
            ticket.resolved_at = datetime.utcnow()
        
        logger.info("Updated ticket $1 status to {status}", ticket_id)
        return ticket
    
    async def create_knowledge_article(self, article: KnowledgeBaseArticle) -> KnowledgeBaseArticle:
        """Create a knowledge base article"""
        knowledge_base[article.article_id] = article
        logger.info(f"Created knowledge base article: {article.article_id}")
        return article
    
    async def search_knowledge_base(self, query: str, category: Optional[str] = None) -> List[KnowledgeBaseArticle]:
        """Search knowledge base articles"""
        results = []
        query_lower = query.lower()
        
        for article in knowledge_base.values():
            if not article.is_published:
                continue
                
            if category and article.category != category:
                continue
            
            # Simple text search
            if (query_lower in article.title.lower() or 
                query_lower in article.content.lower() or 
                any(query_lower in tag.lower() for tag in article.tags)):
                results.append(article)
        
        # Sort by relevance (simplified)
        results.sort(key=lambda x: x.view_count, reverse=True)
        return results
    
    async def schedule_webinar(self, webinar: Webinar) -> Webinar:
        """Schedule a new webinar"""
        webinars[webinar.webinar_id] = webinar
        logger.info(f"Scheduled webinar: {webinar.webinar_id}")
        return webinar
    
    async def get_user_progress(self, user_id: str) -> Dict[str, Any]:
        """Get comprehensive user progress report"""
        user_enrollments = [e for e in enrollments.values() if e.user_id == user_id]
        user_certificates = [c for c in certifications.values() if c.user_id == user_id]
        
        total_courses = len(user_enrollments)
        completed_courses = len([e for e in user_enrollments if e.status == EnrollmentStatus.COMPLETED])
        in_progress_courses = len([e for e in user_enrollments if e.status == EnrollmentStatus.IN_PROGRESS])
        
        avg_score = 0
        if user_enrollments:
            scores = [e.score for e in user_enrollments if e.score is not None]
            avg_score = sum(scores) / len(scores) if scores else 0
        
        return {
            "user_id": user_id,
            "total_courses": total_courses,
            "completed_courses": completed_courses,
            "in_progress_courses": in_progress_courses,
            "completion_rate": (completed_courses / total_courses * 100) if total_courses > 0 else 0,
            "average_score": avg_score,
            "certificates_earned": len(user_certificates),
            "enrollments": user_enrollments,
            "certificates": user_certificates
        }
    
    async def get_training_analytics(self) -> Dict[str, Any]:
        """Get comprehensive training analytics"""
        total_courses = len(courses)
        total_enrollments = len(enrollments)
        total_completions = len([e for e in enrollments.values() if e.status == EnrollmentStatus.COMPLETED])
        
        # Course popularity
        course_enrollment_counts = {}
        for enrollment in enrollments.values():
            course_enrollment_counts[enrollment.course_id] = course_enrollment_counts.get(enrollment.course_id, 0) + 1
        
        popular_courses = sorted(course_enrollment_counts.items(), key=lambda x: x[1], reverse=True)[:5]
        
        # Support metrics
        total_tickets = len(support_tickets)
        open_tickets = len([t for t in support_tickets.values() if t.status == SupportTicketStatus.OPEN])
        resolved_tickets = len([t for t in support_tickets.values() if t.status == SupportTicketStatus.RESOLVED])
        
        return {
            "total_courses": total_courses,
            "total_enrollments": total_enrollments,
            "total_completions": total_completions,
            "completion_rate": (total_completions / total_enrollments * 100) if total_enrollments > 0 else 0,
            "popular_courses": [{"course_id": cid, "enrollments": count} for cid, count in popular_courses],
            "support_metrics": {
                "total_tickets": total_tickets,
                "open_tickets": open_tickets,
                "resolved_tickets": resolved_tickets,
                "resolution_rate": (resolved_tickets / total_tickets * 100) if total_tickets > 0 else 0
            },
            "knowledge_base_articles": len(knowledge_base),
            "scheduled_webinars": len(webinars)
        }

# Initialize service
training_manager = TrainingAndSupportManager()

# API Endpoints
@app.post("/courses", response_model=Course)
async def create_course(course: Course,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create a new training course"""
    return await training_manager.create_course(course)

@app.get("/courses", response_model=List[Course])
async def get_courses(category: Optional[str] = None, status: Optional[CourseStatus] = None,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get all courses with optional filtering"""
    filtered_courses = list(courses.values())
    
    if category:
        filtered_courses = [c for c in filtered_courses if c.category == category]
    if status:
        filtered_courses = [c for c in filtered_courses if c.status == status]
    
    return filtered_courses

@app.get("/courses/{course_id}", response_model=Course)
async def get_course(course_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get a specific course"""
    if course_id not in courses:
        raise HTTPException(status_code=404, detail="Course not found")
    return courses[course_id]

@app.post("/courses/{course_id}/modules", response_model=CourseModule)
async def add_course_module(course_id: str, module: CourseModule,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Add a module to a course"""
    module.course_id = course_id
    return await training_manager.add_course_module(module)

@app.get("/courses/{course_id}/modules", response_model=List[CourseModule])
async def get_course_modules(course_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get all modules for a course"""
    return sorted([m for m in course_modules.values() if m.course_id == course_id], key=lambda x: x.order_index)

@app.post("/quizzes", response_model=Quiz)
async def create_quiz(quiz: Quiz,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create a quiz"""
    return await training_manager.create_quiz(quiz)

@app.post("/enrollments", response_model=Enrollment)
async def enroll_user(user_id: str, course_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Enroll a user in a course"""
    return await training_manager.enroll_user(user_id, course_id)

@app.get("/users/{user_id}/enrollments", response_model=List[Enrollment])
async def get_user_enrollments(user_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get all enrollments for a user"""
    return [e for e in enrollments.values() if e.user_id == user_id]

@app.put("/enrollments/{enrollment_id}/progress")
async def update_progress(enrollment_id: str, module_id: str, completed: bool = False,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Update user progress in a course"""
    return await training_manager.update_progress(enrollment_id, module_id, completed)

@app.post("/quizzes/{quiz_id}/submit")
async def submit_quiz(quiz_id: str, user_id: str, answers: List[Dict[str, Any]],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Submit quiz answers"""
    return await training_manager.submit_quiz(quiz_id, user_id, answers)

@app.get("/users/{user_id}/certificates", response_model=List[Certification])
async def get_user_certificates(user_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get all certificates for a user"""
    return [c for c in certifications.values() if c.user_id == user_id]

@app.post("/support/tickets", response_model=SupportTicket)
async def create_support_ticket(ticket: SupportTicket,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create a support ticket"""
    return await training_manager.create_support_ticket(ticket)

@app.get("/support/tickets", response_model=List[SupportTicket])
async def get_support_tickets(user_id: Optional[str] = None, status: Optional[SupportTicketStatus] = None,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get support tickets with optional filtering"""
    filtered_tickets = list(support_tickets.values())
    
    if user_id:
        filtered_tickets = [t for t in filtered_tickets if t.user_id == user_id]
    if status:
        filtered_tickets = [t for t in filtered_tickets if t.status == status]
    
    return filtered_tickets

@app.put("/support/tickets/{ticket_id}", response_model=SupportTicket)
async def update_ticket_status(ticket_id: str, status: SupportTicketStatus, resolution: Optional[str] = None,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Update support ticket status"""
    return await training_manager.update_ticket_status(ticket_id, status, resolution)

@app.post("/knowledge-base", response_model=KnowledgeBaseArticle)
async def create_knowledge_article(article: KnowledgeBaseArticle,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create a knowledge base article"""
    return await training_manager.create_knowledge_article(article)

@app.get("/knowledge-base/search", response_model=List[KnowledgeBaseArticle])
async def search_knowledge_base(query: str, category: Optional[str] = None,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Search knowledge base articles"""
    return await training_manager.search_knowledge_base(query, category)

@app.post("/webinars", response_model=Webinar)
async def schedule_webinar(webinar: Webinar,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Schedule a webinar"""
    return await training_manager.schedule_webinar(webinar)

@app.get("/webinars", response_model=List[Webinar])
async def get_webinars(
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get all scheduled webinars"""
    return list(webinars.values())

@app.get("/users/{user_id}/progress")
async def get_user_progress(user_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get user progress report"""
    return await training_manager.get_user_progress(user_id)

@app.get("/analytics/training")
async def get_training_analytics(
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get training analytics"""
    return await training_manager.get_training_analytics()

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Training & Support Service",
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8024)