"""
Good Faith Estimates (GFE) Service
Implements NSA-compliant Good Faith Estimates for uninsured and self-pay patients
Includes automated estimate generation, patient notifications, and compliance tracking
"""

import asyncio
import json
import os
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from enum import Enum
from decimal import Decimal, ROUND_HALF_UP
import httpx
import pandas as pd
from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel, Field, validator
import redis.asyncio as redis
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy import Column, String, DateTime, Text, Boolean, Integer, Numeric, select, update, and_
from sqlalchemy.ext.declarative import declarative_base
from jinja2 import Template
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
import uuid
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
import io

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Good Faith Estimates Service", version="2.0.0")

# Database setup
Base = declarative_base()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://user:password@localhost/nsa_idr")
engine = create_async_engine(DATABASE_URL)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

class GoodFaithEstimate(Base):
    """Database model for Good Faith Estimates"""
    __tablename__ = "good_faith_estimates"
    
    id = Column(Integer, primary_key=True)
    gfe_id = Column(String(50), unique=True, nullable=False)
    patient_id = Column(String(100), nullable=False)
    provider_id = Column(String(100), nullable=False)
    facility_id = Column(String(100))
    scheduled_service_date = Column(DateTime, nullable=False)
    primary_service_code = Column(String(20), nullable=False)
    primary_service_description = Column(Text, nullable=False)
    total_estimated_cost = Column(Numeric(10, 2), nullable=False)
    patient_responsibility = Column(Numeric(10, 2), nullable=False)
    estimate_valid_until = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    status = Column(String(50), default="active")
    delivery_method = Column(String(50))
    delivered_at = Column(DateTime)
    patient_acknowledged = Column(Boolean, default=False)
    acknowledged_at = Column(DateTime)

class GFEServiceItem(Base):
    """Database model for GFE service items"""
    __tablename__ = "gfe_service_items"
    
    id = Column(Integer, primary_key=True)
    gfe_id = Column(String(50), nullable=False)
    service_code = Column(String(20), nullable=False)
    service_description = Column(Text, nullable=False)
    provider_npi = Column(String(20))
    provider_name = Column(String(200))
    estimated_cost = Column(Numeric(10, 2), nullable=False)
    item_type = Column(String(50))  # primary, ancillary, facility, professional
    created_at = Column(DateTime, default=datetime.utcnow)

class GFEDisclaimer(Base):
    """Database model for GFE disclaimers and notices"""
    __tablename__ = "gfe_disclaimers"
    
    id = Column(Integer, primary_key=True)
    gfe_id = Column(String(50), nullable=False)
    disclaimer_type = Column(String(50), nullable=False)
    disclaimer_text = Column(Text, nullable=False)
    is_required = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class PatientInfo(BaseModel):
    """Patient information model"""
    patient_id: str = Field(..., min_length=1, max_length=100)
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    date_of_birth: datetime
    phone: Optional[str] = Field(None, regex=r'^\+?1?[0-9]{10,15}$')
    email: Optional[str] = Field(None, regex=r'^[^@]+@[^@]+\.[^@]+$')
    address: Dict[str, str]
    insurance_status: str = Field(..., regex=r'^(uninsured|self_pay|unknown)$')

class ServiceItem(BaseModel):
    """Service item model for GFE"""
    service_code: str = Field(..., regex=r'^[0-9A-Z]{5}$')
    service_description: str = Field(..., min_length=1, max_length=500)
    provider_npi: Optional[str] = Field(None, regex=r'^[0-9]{10}$')
    provider_name: str = Field(..., min_length=1, max_length=200)
    estimated_cost: Decimal = Field(..., ge=0, le=999999.99)
    item_type: str = Field(..., regex=r'^(primary|ancillary|facility|professional)$')

class GFERequest(BaseModel):
    """Request model for Good Faith Estimate generation"""
    patient_info: PatientInfo
    provider_id: str = Field(..., min_length=1, max_length=100)
    facility_id: Optional[str] = Field(None, max_length=100)
    scheduled_service_date: datetime
    primary_service: ServiceItem
    additional_services: List[ServiceItem] = []
    delivery_method: str = Field(..., regex=r'^(email|mail|patient_portal|in_person)$')
    
    @validator('scheduled_service_date')
    def validate_service_date(cls, v):
        if v <= datetime.now():
            raise ValueError("Scheduled service date must be in the future")
        return v

class GFEResponse(BaseModel):
    """Response model for Good Faith Estimate"""
    gfe_id: str
    patient_name: str
    provider_name: str
    scheduled_service_date: datetime
    primary_service_description: str
    total_estimated_cost: Decimal
    patient_responsibility: Decimal
    estimate_valid_until: datetime
    service_items: List[Dict[str, Any]]
    disclaimers: List[str]
    delivery_status: str
    created_at: datetime

class GFEDeliveryMethod(str, Enum):
    EMAIL = "email"
    MAIL = "mail"
    PATIENT_PORTAL = "patient_portal"
    IN_PERSON = "in_person"

class GoodFaithEstimatesService:
    """Production-ready Good Faith Estimates service"""
    
    def __init__(self):
        self.redis_client = None
        self.smtp_config = {
            "host": os.getenv("SMTP_HOST", "localhost"),
            "port": int(os.getenv("SMTP_PORT", "587")),
            "username": os.getenv("SMTP_USERNAME", ""),
            "password": os.getenv("SMTP_PASSWORD", ""),
            "use_tls": os.getenv("SMTP_USE_TLS", "true").lower() == "true"
        }
        self._initialize_templates()
    
    def _initialize_templates(self):
        """Initialize email and document templates"""
        self.email_template = Template("""
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .header { background-color: #f8f9fa; padding: 20px; border-radius: 5px; }
                .content { margin: 20px 0; }
                .estimate-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                .estimate-table th, .estimate-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                .estimate-table th { background-color: #f2f2f2; }
                .total-row { font-weight: bold; background-color: #e9ecef; }
                .disclaimer { font-size: 12px; color: #666; margin-top: 20px; padding: 10px; background-color: #f8f9fa; }
            </style>
        </head>
        <body>
            <div class="header">
                <h2>Good Faith Estimate</h2>
                <p><strong>Estimate ID:</strong> {{ gfe_id }}</p>
                <p><strong>Patient:</strong> {{ patient_name }}</p>
                <p><strong>Provider:</strong> {{ provider_name }}</p>
                <p><strong>Scheduled Date:</strong> {{ scheduled_date }}</p>
            </div>
            
            <div class="content">
                <h3>Estimated Costs for Your Healthcare Services</h3>
                <p>This is a Good Faith Estimate showing the costs of items and services that are reasonably expected for your healthcare needs for an item or service. The estimate is based on information known at the time the estimate was created.</p>
                
                <table class="estimate-table">
                    <thead>
                        <tr>
                            <th>Service Code</th>
                            <th>Description</th>
                            <th>Provider</th>
                            <th>Estimated Cost</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for item in service_items %}
                        <tr>
                            <td>{{ item.service_code }}</td>
                            <td>{{ item.service_description }}</td>
                            <td>{{ item.provider_name }}</td>
                            <td>${{ "%.2f"|format(item.estimated_cost) }}</td>
                        </tr>
                        {% endfor %}
                        <tr class="total-row">
                            <td colspan="3"><strong>Total Estimated Cost</strong></td>
                            <td><strong>${{ "%.2f"|format(total_cost) }}</strong></td>
                        </tr>
                        <tr class="total-row">
                            <td colspan="3"><strong>Your Estimated Responsibility</strong></td>
                            <td><strong>${{ "%.2f"|format(patient_responsibility) }}</strong></td>
                        </tr>
                    </tbody>
                </table>
                
                <p><strong>This estimate is valid until:</strong> {{ valid_until }}</p>
            </div>
            
            <div class="disclaimer">
                <h4>Important Information About Your Estimate</h4>
                {% for disclaimer in disclaimers %}
                <p>• {{ disclaimer }}</p>
                {% endfor %}
            </div>
        </body>
        </html>
        """)
    
    async def _get_redis_client(self) -> redis.Redis:
        """Get Redis client for caching"""
        if not self.redis_client:
            redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
            self.redis_client = redis.from_url(redis_url)
        return self.redis_client
    
    async def _get_db_session(self) -> AsyncSession:
        """Get database session"""
        return AsyncSessionLocal()
    
    def _generate_gfe_id(self) -> str:
        """Generate unique GFE ID"""
        return f"GFE-{datetime.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
    
    async def generate_good_faith_estimate(self, request: GFERequest) -> GFEResponse:
        """Generate a Good Faith Estimate"""
        try:
            gfe_id = self._generate_gfe_id()
            
            # Calculate total estimated cost
            total_cost = request.primary_service.estimated_cost
            for service in request.additional_services:
                total_cost += service.estimated_cost
            
            # For uninsured/self-pay patients, patient responsibility equals total cost
            patient_responsibility = total_cost
            
            # Estimate is valid for 1 year or until service date, whichever is sooner
            estimate_valid_until = min(
                datetime.now() + timedelta(days=365),
                request.scheduled_service_date
            )
            
            async with self._get_db_session() as session:
                # Create main GFE record
                gfe = GoodFaithEstimate(
                    gfe_id=gfe_id,
                    patient_id=request.patient_info.patient_id,
                    provider_id=request.provider_id,
                    facility_id=request.facility_id,
                    scheduled_service_date=request.scheduled_service_date,
                    primary_service_code=request.primary_service.service_code,
                    primary_service_description=request.primary_service.service_description,
                    total_estimated_cost=total_cost,
                    patient_responsibility=patient_responsibility,
                    estimate_valid_until=estimate_valid_until,
                    delivery_method=request.delivery_method
                )
                session.add(gfe)
                
                # Create service items
                all_services = [request.primary_service] + request.additional_services
                service_items_data = []
                
                for service in all_services:
                    service_item = GFEServiceItem(
                        gfe_id=gfe_id,
                        service_code=service.service_code,
                        service_description=service.service_description,
                        provider_npi=service.provider_npi,
                        provider_name=service.provider_name,
                        estimated_cost=service.estimated_cost,
                        item_type=service.item_type
                    )
                    session.add(service_item)
                    
                    service_items_data.append({
                        "service_code": service.service_code,
                        "service_description": service.service_description,
                        "provider_name": service.provider_name,
                        "estimated_cost": service.estimated_cost,
                        "item_type": service.item_type
                    })
                
                # Create standard disclaimers
                disclaimers = await self._generate_standard_disclaimers(gfe_id, session)
                
                await session.commit()
                
                # Deliver the estimate
                delivery_status = await self._deliver_estimate(gfe_id, request, session)
                
                return GFEResponse(
                    gfe_id=gfe_id,
                    patient_name=f"{request.patient_info.first_name} {request.patient_info.last_name}",
                    provider_name=request.primary_service.provider_name,
                    scheduled_service_date=request.scheduled_service_date,
                    primary_service_description=request.primary_service.service_description,
                    total_estimated_cost=total_cost,
                    patient_responsibility=patient_responsibility,
                    estimate_valid_until=estimate_valid_until,
                    service_items=service_items_data,
                    disclaimers=[d["disclaimer_text"] for d in disclaimers],
                    delivery_status=delivery_status,
                    created_at=datetime.utcnow()
                )
                
        except Exception as e:
            logger.error(f"Error generating GFE: {e}")
            raise HTTPException(status_code=500, detail=f"GFE generation error: {str(e)}")
    
    async def _generate_standard_disclaimers(self, gfe_id: str, session: AsyncSession) -> List[Dict[str, Any]]:
        """Generate standard NSA-compliant disclaimers"""
        standard_disclaimers = [
            {
                "type": "estimate_nature",
                "text": "This estimate shows the costs of items and services that are reasonably expected for your healthcare needs for an item or service. The estimate is based on information known at the time the estimate was created. Actual items, services, or costs may differ from this Good Faith Estimate."
            },
            {
                "type": "billing_rights",
                "text": "If you are billed for more than this Good Faith Estimate, you have the right to dispute the bill. You may contact the healthcare provider or facility listed to let them know the billed charges are higher than the Good Faith Estimate. You can ask them to update the bill to match the Good Faith Estimate, ask to negotiate the bill, or ask if there is financial assistance available."
            },
            {
                "type": "dispute_process",
                "text": "You may also start a dispute resolution process with the U.S. Department of Health and Human Services (HHS). If you choose to use the dispute resolution process, you must start the process within 120 calendar days (about 4 months) of the date on the original bill. There is a $25 fee to use the dispute resolution process. If the agency reviewing your dispute agrees with you, you will not have to pay the fee."
            },
            {
                "type": "additional_services",
                "text": "If additional items or services are needed that are not included in this estimate, you will receive a separate Good Faith Estimate for those items or services."
            },
            {
                "type": "network_status",
                "text": "This estimate is provided because you are uninsured or are a self-pay patient. If you have insurance, your costs may be different depending on your insurance plan and whether the providers are in your insurance network."
            },
            {
                "type": "estimate_validity",
                "text": "This estimate is valid until the date shown above. Costs may change if your service is scheduled after this date or if additional services become necessary."
            }
        ]
        
        disclaimers_data = []
        for disclaimer in standard_disclaimers:
            disclaimer_record = GFEDisclaimer(
                gfe_id=gfe_id,
                disclaimer_type=disclaimer["type"],
                disclaimer_text=disclaimer["text"],
                is_required=True
            )
            session.add(disclaimer_record)
            disclaimers_data.append({
                "disclaimer_type": disclaimer["type"],
                "disclaimer_text": disclaimer["text"]
            })
        
        return disclaimers_data
    
    async def _deliver_estimate(self, gfe_id: str, request: GFERequest, session: AsyncSession) -> str:
        """Deliver the Good Faith Estimate to the patient"""
        try:
            if request.delivery_method == GFEDeliveryMethod.EMAIL:
                if not request.patient_info.email:
                    return "failed_no_email"
                
                success = await self._send_email_estimate(gfe_id, request)
                if success:
                    # Update delivery status
                    await session.execute(
                        update(GoodFaithEstimate)
                        .where(GoodFaithEstimate.gfe_id == gfe_id)
                        .values(delivered_at=datetime.utcnow())
                    )
                    await session.commit()
                    return "delivered_email"
                else:
                    return "failed_email"
            
            elif request.delivery_method == GFEDeliveryMethod.MAIL:
                # In production, integrate with mailing service
                await self._schedule_mail_delivery(gfe_id, request)
                return "scheduled_mail"
            
            elif request.delivery_method == GFEDeliveryMethod.PATIENT_PORTAL:
                # In production, integrate with patient portal
                await self._deliver_to_patient_portal(gfe_id, request)
                return "delivered_portal"
            
            elif request.delivery_method == GFEDeliveryMethod.IN_PERSON:
                # Mark as ready for in-person delivery
                return "ready_in_person"
            
            else:
                return "unknown_method"
                
        except Exception as e:
            logger.error(f"Error delivering estimate {gfe_id}: {e}")
            return "delivery_error"
    
    async def _send_email_estimate(self, gfe_id: str, request: GFERequest) -> bool:
        """Send Good Faith Estimate via email"""
        try:
            # Get GFE data
            async with self._get_db_session() as session:
                gfe_result = await session.execute(
                    select(GoodFaithEstimate).where(GoodFaithEstimate.gfe_id == gfe_id)
                )
                gfe = gfe_result.scalar_one()
                
                items_result = await session.execute(
                    select(GFEServiceItem).where(GFEServiceItem.gfe_id == gfe_id)
                )
                service_items = items_result.scalars().all()
                
                disclaimers_result = await session.execute(
                    select(GFEDisclaimer).where(GFEDisclaimer.gfe_id == gfe_id)
                )
                disclaimers = disclaimers_result.scalars().all()
            
            # Prepare email content
            service_items_data = [
                {
                    "service_code": item.service_code,
                    "service_description": item.service_description,
                    "provider_name": item.provider_name,
                    "estimated_cost": float(item.estimated_cost)
                }
                for item in service_items
            ]
            
            disclaimers_text = [disclaimer.disclaimer_text for disclaimer in disclaimers]
            
            html_content = self.email_template.render(
                gfe_id=gfe_id,
                patient_name=f"{request.patient_info.first_name} {request.patient_info.last_name}",
                provider_name=request.primary_service.provider_name,
                scheduled_date=request.scheduled_service_date.strftime("%B %d, %Y"),
                service_items=service_items_data,
                total_cost=float(gfe.total_estimated_cost),
                patient_responsibility=float(gfe.patient_responsibility),
                valid_until=gfe.estimate_valid_until.strftime("%B %d, %Y"),
                disclaimers=disclaimers_text
            )
            
            # Generate PDF attachment
            pdf_content = await self._generate_pdf_estimate(gfe, service_items_data, disclaimers_text, request)
            
            # Send email
            msg = MIMEMultipart()
            msg['From'] = self.smtp_config['username']
            msg['To'] = request.patient_info.email
            msg['Subject'] = f"Good Faith Estimate - {gfe_id}"
            
            msg.attach(MIMEText(html_content, 'html'))
            
            # Attach PDF
            pdf_attachment = MIMEApplication(pdf_content, _subtype='pdf')
            pdf_attachment.add_header('Content-Disposition', 'attachment', filename=f'GFE_{gfe_id}.pdf')
            msg.attach(pdf_attachment)
            
            # Send via SMTP
            with smtplib.SMTP(self.smtp_config['host'], self.smtp_config['port']) as server:
                if self.smtp_config['use_tls']:
                    server.starttls()
                if self.smtp_config['username'] and self.smtp_config['password']:
                    server.login(self.smtp_config['username'], self.smtp_config['password'])
                server.send_message(msg)
            
            logger.info(f"GFE {gfe_id} sent via email to {request.patient_info.email}")
            return True
            
        except Exception as e:
            logger.error(f"Error sending email for GFE {gfe_id}: {e}")
            return False
    
    async def _generate_pdf_estimate(self, gfe: GoodFaithEstimate, service_items: List[Dict], disclaimers: List[str], request: GFERequest) -> bytes:
        """Generate PDF version of Good Faith Estimate"""
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter)
        styles = getSampleStyleSheet()
        story = []
        
        # Title
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=18,
            spaceAfter=30,
            alignment=1  # Center alignment
        )
        story.append(Paragraph("Good Faith Estimate", title_style))
        story.append(Spacer(1, 12))
        
        # Header information
        header_data = [
            ['Estimate ID:', gfe.gfe_id],
            ['Patient:', f"{request.patient_info.first_name} {request.patient_info.last_name}"],
            ['Provider:', request.primary_service.provider_name],
            ['Scheduled Date:', gfe.scheduled_service_date.strftime("%B %d, %Y")],
            ['Valid Until:', gfe.estimate_valid_until.strftime("%B %d, %Y")]
        ]
        
        header_table = Table(header_data, colWidths=[2*inch, 4*inch])
        header_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        story.append(header_table)
        story.append(Spacer(1, 20))
        
        # Services table
        story.append(Paragraph("Estimated Costs for Your Healthcare Services", styles['Heading2']))
        story.append(Spacer(1, 12))
        
        service_data = [['Service Code', 'Description', 'Provider', 'Estimated Cost']]
        for item in service_items:
            service_data.append([
                item['service_code'],
                item['service_description'][:50] + '...' if len(item['service_description']) > 50 else item['service_description'],
                item['provider_name'],
                f"${item['estimated_cost']:.2f}"
            ])
        
        # Add totals
        service_data.append(['', '', 'Total Estimated Cost:', f"${float(gfe.total_estimated_cost):.2f}"])
        service_data.append(['', '', 'Your Estimated Responsibility:', f"${float(gfe.patient_responsibility):.2f}"])
        
        service_table = Table(service_data, colWidths=[1*inch, 2.5*inch, 1.5*inch, 1*inch])
        service_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('ALIGN', (-1, 0), (-1, -1), 'RIGHT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('BACKGROUND', (0, -2), (-1, -1), colors.lightgrey),
            ('FONTNAME', (0, -2), (-1, -1), 'Helvetica-Bold'),
            ('GRID', (0, 0), (-1, -1), 1, colors.black)
        ]))
        story.append(service_table)
        story.append(Spacer(1, 20))
        
        # Disclaimers
        story.append(Paragraph("Important Information About Your Estimate", styles['Heading2']))
        story.append(Spacer(1, 12))
        
        for disclaimer in disclaimers:
            story.append(Paragraph(f"• {disclaimer}", styles['Normal']))
            story.append(Spacer(1, 6))
        
        doc.build(story)
        buffer.seek(0)
        return buffer.read()
    
    async def _schedule_mail_delivery(self, gfe_id: str, request: GFERequest):
        """Schedule mail delivery of GFE"""
        # In production, integrate with mailing service API
        logger.info(f"Scheduled mail delivery for GFE {gfe_id}")
    
    async def _deliver_to_patient_portal(self, gfe_id: str, request: GFERequest):
        """Deliver GFE to patient portal"""
        # In production, integrate with patient portal API
        logger.info(f"Delivered GFE {gfe_id} to patient portal")
    
    async def get_gfe_by_id(self, gfe_id: str) -> Optional[GFEResponse]:
        """Retrieve a Good Faith Estimate by ID"""
        try:
            async with self._get_db_session() as session:
                gfe_result = await session.execute(
                    select(GoodFaithEstimate).where(GoodFaithEstimate.gfe_id == gfe_id)
                )
                gfe = gfe_result.scalar_one_or_none()
                
                if not gfe:
                    return None
                
                items_result = await session.execute(
                    select(GFEServiceItem).where(GFEServiceItem.gfe_id == gfe_id)
                )
                service_items = items_result.scalars().all()
                
                disclaimers_result = await session.execute(
                    select(GFEDisclaimer).where(GFEDisclaimer.gfe_id == gfe_id)
                )
                disclaimers = disclaimers_result.scalars().all()
                
                service_items_data = [
                    {
                        "service_code": item.service_code,
                        "service_description": item.service_description,
                        "provider_name": item.provider_name,
                        "estimated_cost": item.estimated_cost,
                        "item_type": item.item_type
                    }
                    for item in service_items
                ]
                
                return GFEResponse(
                    gfe_id=gfe.gfe_id,
                    patient_name="Patient Name",  # Would get from patient service
                    provider_name=service_items[0].provider_name if service_items else "Unknown",
                    scheduled_service_date=gfe.scheduled_service_date,
                    primary_service_description=gfe.primary_service_description,
                    total_estimated_cost=gfe.total_estimated_cost,
                    patient_responsibility=gfe.patient_responsibility,
                    estimate_valid_until=gfe.estimate_valid_until,
                    service_items=service_items_data,
                    disclaimers=[d.disclaimer_text for d in disclaimers],
                    delivery_status=gfe.status,
                    created_at=gfe.created_at
                )
                
        except Exception as e:
            logger.error(f"Error retrieving GFE {gfe_id}: {e}")
            return None
    
    async def acknowledge_gfe(self, gfe_id: str, patient_id: str) -> bool:
        """Record patient acknowledgment of GFE"""
        try:
            async with self._get_db_session() as session:
                result = await session.execute(
                    update(GoodFaithEstimate)
                    .where(
                        and_(
                            GoodFaithEstimate.gfe_id == gfe_id,
                            GoodFaithEstimate.patient_id == patient_id
                        )
                    )
                    .values(
                        patient_acknowledged=True,
                        acknowledged_at=datetime.utcnow()
                    )
                )
                
                await session.commit()
                return result.rowcount > 0
                
        except Exception as e:
            logger.error(f"Error acknowledging GFE {gfe_id}: {e}")
            return False

# Initialize service
gfe_service = GoodFaithEstimatesService()

@app.post("/gfe/generate", response_model=GFEResponse)
async def generate_estimate(request: GFERequest):
    """Generate a Good Faith Estimate"""
    return await gfe_service.generate_good_faith_estimate(request)

@app.get("/gfe/{gfe_id}", response_model=GFEResponse)
async def get_estimate(gfe_id: str):
    """Get a Good Faith Estimate by ID"""
    gfe = await gfe_service.get_gfe_by_id(gfe_id)
    if not gfe:
        raise HTTPException(status_code=404, detail="Good Faith Estimate not found")
    return gfe

@app.post("/gfe/{gfe_id}/acknowledge")
async def acknowledge_estimate(gfe_id: str, patient_id: str):
    """Record patient acknowledgment of GFE"""
    success = await gfe_service.acknowledge_gfe(gfe_id, patient_id)
    if not success:
        raise HTTPException(status_code=404, detail="GFE not found or acknowledgment failed")
    return {"status": "acknowledged", "gfe_id": gfe_id, "acknowledged_at": datetime.utcnow()}

@app.get("/gfe/patient/{patient_id}")
async def get_patient_estimates(patient_id: str):
    """Get all Good Faith Estimates for a patient"""
    try:
        async with gfe_service._get_db_session() as session:
            result = await session.execute(
                select(GoodFaithEstimate).where(GoodFaithEstimate.patient_id == patient_id)
                .order_by(GoodFaithEstimate.created_at.desc())
            )
            estimates = result.scalars().all()
            
            return [
                {
                    "gfe_id": gfe.gfe_id,
                    "scheduled_service_date": gfe.scheduled_service_date,
                    "primary_service_description": gfe.primary_service_description,
                    "total_estimated_cost": gfe.total_estimated_cost,
                    "status": gfe.status,
                    "created_at": gfe.created_at
                }
                for gfe in estimates
            ]
            
    except Exception as e:
        logger.error(f"Error retrieving patient estimates: {e}")
        raise HTTPException(status_code=500, detail="Error retrieving estimates")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "good-faith-estimates-service",
        "version": "2.0.0",
        "timestamp": datetime.utcnow().isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8022)
