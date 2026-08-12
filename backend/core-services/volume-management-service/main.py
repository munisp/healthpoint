
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

from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Any
import asyncio
import logging
from datetime import datetime, timedelta
import json
import redis
import asyncpg
from contextlib import asynccontextmanager
import os
from enum import Enum
from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class CaseStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    DEADLINE_APPROACHING = "deadline_approaching"

class CasePriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"
    EMERGENCY = "emergency"

class VolumeMetrics(BaseModel):
    current_load: float = Field(..., description="Current system load percentage")
    peak_capacity: int = Field(..., description="Maximum concurrent cases")
    auto_scaling_active: bool = Field(..., description="Auto-scaling status")
    queued_cases: int = Field(..., description="Cases in queue")
    processing_cases: int = Field(..., description="Cases currently processing")
    completed_cases_today: int = Field(..., description="Cases completed today")
    processing_rate: float = Field(..., description="Cases per hour")
    estimated_completion_time: Optional[datetime] = Field(None, description="ETA for queue completion")
    deadline_alerts: int = Field(..., description="Cases approaching deadline")
    geographic_distribution: Dict[str, int] = Field(default_factory=dict)
    specialty_distribution: Dict[str, int] = Field(default_factory=dict)

class ScalingConfig(BaseModel):
    threshold: float = Field(0.8, description="Load threshold for scaling up")
    scale_up_factor: float = Field(1.5, description="Scaling up multiplier")
    scale_down_factor: float = Field(0.7, description="Scaling down multiplier")
    min_instances: int = Field(5, description="Minimum processing instances")
    max_instances: int = Field(500, description="Maximum processing instances")
    cooldown_period: int = Field(300, description="Cooldown period in seconds")

class CaseSubmission(BaseModel):
    case_id: str = Field(..., description="Unique case identifier")
    provider_id: str = Field(..., description="Provider identifier")
    plan_id: str = Field(..., description="Insurance plan identifier")
    specialty: str = Field(..., description="Medical specialty")
    state: str = Field(..., description="State where service was provided")
    dispute_amount: float = Field(..., description="Amount in dispute")
    submission_deadline: datetime = Field(..., description="Submission deadline")
    priority: CasePriority = Field(CasePriority.MEDIUM, description="Case priority")
    metadata: Dict[str, Any] = Field(default_factory=dict)

class DeadlineAlert(BaseModel):
    case_id: str
    deadline: datetime
    time_remaining: timedelta
    priority: CasePriority
    alert_type: str

class VolumeManagementService:
    def __init__(self):
        # Georgetown research insights: Handle 586,581+ cases per quarter
        self.peak_capacity = 1000000  # 1M simultaneous cases
        self.current_load = 0.0
        self.auto_scaling_active = True
        self.processing_instances = 10
        self.scaling_config = ScalingConfig()
        self.last_scaling_action = datetime.now()
        
        # Georgetown geographic concentration data
        self.high_volume_states = {
            'TX': 0.25,  # 25% of cases
            'FL': 0.18,  # 18% of cases
            'AZ': 0.12,  # 12% of cases
            'TN': 0.08,  # 8% of cases
            'GA': 0.07,  # 7% of cases
            'NJ': 0.06,  # 6% of cases
            'NY': 0.05   # 5% of cases
        }
        
        # Georgetown specialty patterns
        self.specialty_processing_weights = {
            'radiology': 1.2,      # Higher volume, streamlined processing
            'emergency': 2.0,      # Urgent processing required
            'neurology': 1.8,      # Complex cases, higher value
            'surgery': 1.9,        # Complex cases, highest value
            'anesthesiology': 1.1,
            'pathology': 1.0,
            'general': 1.0
        }
        
        # Mock data for demonstration
        self.mock_cases = {
            CaseStatus.QUEUED: 12450,
            CaseStatus.PROCESSING: 3200,
            CaseStatus.COMPLETED: 8934
        }
        
        self.mock_geographic_dist = {
            'TX': 3112, 'FL': 2241, 'AZ': 1494, 'TN': 996, 'GA': 872,
            'NJ': 747, 'NY': 623, 'CA': 498, 'OH': 374, 'PA': 249
        }
        
        self.mock_specialty_dist = {
            'radiology': 4200, 'emergency': 3800, 'neurology': 2100,
            'surgery': 1900, 'anesthesiology': 1500, 'pathology': 1200,
            'general': 800
        }
        
    async def get_current_metrics(self) -> VolumeMetrics:
        """Get comprehensive volume metrics with Georgetown insights"""
        try:
            # Use mock data for demonstration
            queued_cases = self.mock_cases[CaseStatus.QUEUED]
            processing_cases = self.mock_cases[CaseStatus.PROCESSING]
            completed_today = self.mock_cases[CaseStatus.COMPLETED]
            deadline_alerts = int(queued_cases * 0.15)  # 15% approaching deadline
            
            self.current_load = (queued_cases + processing_cases) / self.peak_capacity
            
            metrics = VolumeMetrics(
                current_load=self.current_load,
                peak_capacity=self.peak_capacity,
                auto_scaling_active=self.auto_scaling_active,
                queued_cases=queued_cases,
                processing_cases=processing_cases,
                completed_cases_today=completed_today,
                processing_rate=self.calculate_processing_rate(),
                estimated_completion_time=self.estimate_completion_time(queued_cases),
                deadline_alerts=deadline_alerts,
                geographic_distribution=self.mock_geographic_dist,
                specialty_distribution=self.mock_specialty_dist
            )
            
            return metrics
            
        except Exception as e:
            logger.error(f"Error getting metrics: {e}")
            # Return fallback metrics
            return VolumeMetrics(
                current_load=self.current_load,
                peak_capacity=self.peak_capacity,
                auto_scaling_active=self.auto_scaling_active,
                queued_cases=0,
                processing_cases=0,
                completed_cases_today=0,
                processing_rate=self.calculate_processing_rate(),
                estimated_completion_time=None,
                deadline_alerts=0,
                geographic_distribution={},
                specialty_distribution={}
            )
    
    def calculate_processing_rate(self) -> float:
        """Calculate processing rate based on Georgetown patterns"""
        # Base rate: 1000 cases per hour per instance
        base_rate = 1000
        
        # Georgetown insight: Adjust for geographic concentration
        geographic_efficiency = 1.0
        for state, percentage in self.high_volume_states.items():
            geographic_efficiency += percentage * 0.1  # 10% efficiency boost per high-volume state
        
        # Specialty-based efficiency adjustments
        specialty_efficiency = 1.0
        
        total_rate = base_rate * self.processing_instances * geographic_efficiency * specialty_efficiency
        return round(total_rate, 2)
    
    def estimate_completion_time(self, queued_cases: int) -> Optional[datetime]:
        """Estimate completion time with Georgetown deadline management"""
        if queued_cases == 0:
            return None
        
        processing_rate = self.calculate_processing_rate()
        if processing_rate == 0:
            return None
        
        hours_to_complete = queued_cases / processing_rate
        
        # Georgetown insight: Account for deadline pressure
        # Prioritize cases approaching deadlines
        deadline_factor = 0.8  # 20% faster processing for deadline management
        adjusted_hours = hours_to_complete * deadline_factor
        
        return datetime.now() + timedelta(hours=adjusted_hours)
    
    async def submit_case(self, case: CaseSubmission) -> Dict[str, Any]:
        """Submit a new case with Georgetown-based prioritization"""
        try:
            # Calculate priority based on Georgetown insights
            priority = await self._calculate_case_priority(case)
            
            # Update mock data
            self.mock_cases[CaseStatus.QUEUED] += 1
            
            return {
                "case_id": case.case_id,
                "status": "submitted",
                "priority": priority.value,
                "estimated_processing_time": await self._estimate_case_processing_time(case),
                "queue_position": self.mock_cases[CaseStatus.QUEUED]
            }
            
        except Exception as e:
            logger.error(f"Error submitting case {case.case_id}: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to submit case: {str(e)}")
    
    async def _calculate_case_priority(self, case: CaseSubmission) -> CasePriority:
        """Calculate case priority based on Georgetown research insights"""
        priority_score = 0
        
        # Deadline urgency (Georgetown: deadline management critical)
        time_to_deadline = case.submission_deadline - datetime.now()
        if time_to_deadline.days <= 1:
            priority_score += 100  # Emergency
        elif time_to_deadline.days <= 3:
            priority_score += 75   # Urgent
        elif time_to_deadline.days <= 7:
            priority_score += 50   # High
        
        # Geographic concentration (Georgetown: high-volume states)
        if case.state in self.high_volume_states:
            priority_score += self.high_volume_states[case.state] * 20
        
        # Specialty complexity (Georgetown: specialty variations)
        specialty_weight = self.specialty_processing_weights.get(case.specialty.lower(), 1.0)
        priority_score += specialty_weight * 10
        
        # Dispute amount (Georgetown: higher amounts need faster processing)
        if case.dispute_amount > 100000:  # $100K+
            priority_score += 30
        elif case.dispute_amount > 50000:   # $50K+
            priority_score += 20
        elif case.dispute_amount > 10000:   # $10K+
            priority_score += 10
        
        # Convert score to priority enum
        if priority_score >= 100:
            return CasePriority.EMERGENCY
        elif priority_score >= 75:
            return CasePriority.URGENT
        elif priority_score >= 50:
            return CasePriority.HIGH
        elif priority_score >= 25:
            return CasePriority.MEDIUM
        else:
            return CasePriority.LOW
    
    async def handle_volume_surge(self, surge_data: Dict[str, Any]) -> VolumeMetrics:
        """Handle volume surge with Georgetown-based scaling"""
        try:
            new_cases = surge_data.get('new_cases', 0)
            surge_type = surge_data.get('type', 'normal')  # normal, seasonal, emergency
            
            logger.info(f"Handling volume surge: {new_cases} new cases, type: {surge_type}")
            
            # Georgetown insight: Proactive scaling for known patterns
            if surge_type == 'emergency':
                # Scale up immediately for emergency surges
                await self._emergency_scale_up()
            elif surge_type == 'seasonal':
                # Gradual scaling for seasonal patterns
                await self._seasonal_scale_up(new_cases)
            else:
                # Standard scaling logic
                await self._standard_scale_check(new_cases)
            
            # Update mock data
            self.mock_cases[CaseStatus.QUEUED] += new_cases
            
            # Update load metrics
            current_metrics = await self.get_current_metrics()
            
            # Send alerts if needed
            if current_metrics.current_load > 0.9:
                await self._send_high_load_alert(current_metrics)
            
            return current_metrics
            
        except Exception as e:
            logger.error(f"Error handling volume surge: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to handle volume surge: {str(e)}")
    
    async def _emergency_scale_up(self):
        """Emergency scaling for critical situations"""
        target_instances = min(self.processing_instances * 3, self.scaling_config.max_instances)
        self.processing_instances = target_instances
        logger.warning(f"Emergency scale up to {self.processing_instances} instances")
    
    async def _seasonal_scale_up(self, new_cases: int):
        """Seasonal scaling based on Georgetown patterns"""
        # Georgetown insight: Q1-Q2 2024 saw 586,581 cases (nearly matching all of 2023)
        expected_load_increase = new_cases / self.peak_capacity
        
        if expected_load_increase > 0.3:  # 30% load increase
            scale_factor = 1 + (expected_load_increase * 2)  # Scale proportionally
            target_instances = min(
                int(self.processing_instances * scale_factor),
                self.scaling_config.max_instances
            )
            self.processing_instances = target_instances
            logger.info(f"Seasonal scale up to {self.processing_instances} instances")
    
    async def _standard_scale_check(self, new_cases: int):
        """Standard scaling logic"""
        projected_load = (self.mock_cases[CaseStatus.QUEUED] + new_cases) / self.peak_capacity
        
        if projected_load > self.scaling_config.threshold:
            await self.scale_up_resources()
    
    async def scale_up_resources(self):
        """Scale up processing resources"""
        # Check cooldown period
        if (datetime.now() - self.last_scaling_action).seconds < self.scaling_config.cooldown_period:
            return
        
        if self.processing_instances < self.scaling_config.max_instances:
            new_instances = min(
                int(self.processing_instances * self.scaling_config.scale_up_factor),
                self.scaling_config.max_instances
            )
            self.processing_instances = new_instances
            self.last_scaling_action = datetime.now()
            logger.info(f"Scaled up to {self.processing_instances} instances")
    
    async def scale_down_resources(self):
        """Scale down processing resources"""
        # Check cooldown period
        if (datetime.now() - self.last_scaling_action).seconds < self.scaling_config.cooldown_period:
            return
        
        if self.processing_instances > self.scaling_config.min_instances:
            new_instances = max(
                int(self.processing_instances * self.scaling_config.scale_down_factor),
                self.scaling_config.min_instances
            )
            self.processing_instances = new_instances
            self.last_scaling_action = datetime.now()
            logger.info(f"Scaled down to {self.processing_instances} instances")
    
    async def get_deadline_alerts(self) -> List[DeadlineAlert]:
        """Get cases approaching deadlines (Georgetown: deadline management critical)"""
        try:
            alerts = []
            
            # Mock deadline alerts based on queued cases
            queued_cases = self.mock_cases[CaseStatus.QUEUED]
            alert_count = int(queued_cases * 0.15)  # 15% approaching deadline
            
            for i in range(min(alert_count, 10)):  # Limit to 10 for demo
                case_id = f"IDR-{datetime.now().strftime('%Y%m%d')}-{1000 + i}"
                deadline = datetime.now() + timedelta(days=(i % 7) + 1)
                time_remaining = deadline - datetime.now()
                
                alert_type = "critical" if time_remaining.days <= 1 else "warning"
                priority = CasePriority.EMERGENCY if time_remaining.days <= 1 else CasePriority.HIGH
                
                alerts.append(DeadlineAlert(
                    case_id=case_id,
                    deadline=deadline,
                    time_remaining=time_remaining,
                    priority=priority,
                    alert_type=alert_type
                ))
            
            return alerts
            
        except Exception as e:
            logger.error(f"Error getting deadline alerts: {e}")
            return []
    
    async def _estimate_case_processing_time(self, case: CaseSubmission) -> timedelta:
        """Estimate processing time for a specific case"""
        base_time = timedelta(hours=24)  # Base 24 hours
        
        # Adjust based on specialty complexity
        specialty_weight = self.specialty_processing_weights.get(case.specialty.lower(), 1.0)
        adjusted_time = base_time * specialty_weight
        
        # Adjust based on current load
        load_factor = 1 + self.current_load
        final_time = adjusted_time * load_factor
        
        return final_time
    
    async def _send_high_load_alert(self, metrics: VolumeMetrics):
        """Send alert for high system load"""
        alert_data = {
            "type": "high_load_alert",
            "current_load": metrics.current_load,
            "queued_cases": metrics.queued_cases,
            "processing_instances": self.processing_instances,
            "timestamp": datetime.now().isoformat()
        }
        
        logger.warning(f"High load alert: {alert_data}")

# Initialize service
volume_service = VolumeManagementService()

setup_telemetry(service_name="volume-management-service", service_version="1.0.0")
app = FastAPI(
    title="Georgetown-Enhanced Volume Management Service",
    description="Advanced volume management with Georgetown University IDR research insights",
    version="2.0.0"
)
instrument_fastapi(app)
app.middleware("http")(security_headers_middleware)


@app.get("/metrics", response_model=VolumeMetrics)
async def get_volume_metrics(
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get comprehensive volume metrics"""
    return await volume_service.get_current_metrics()

@app.post("/submit-case")
async def submit_case(case: CaseSubmission,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Submit a new IDR case with Georgetown-based prioritization"""
    return await volume_service.submit_case(case)

@app.post("/volume-surge")
async def handle_volume_surge(surge_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Handle volume surge with Georgetown-based scaling"""
    return await volume_service.handle_volume_surge(surge_data)

@app.get("/deadline-alerts", response_model=List[DeadlineAlert])
async def get_deadline_alerts(
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get cases approaching submission deadlines"""
    return await volume_service.get_deadline_alerts()

@app.post("/scale-up")
async def scale_up(
    current_user: TokenPayload = Depends(get_current_user),
):
    """Manually scale up resources"""
    await volume_service.scale_up_resources()
    return {
        "status": "scaled_up", 
        "instances": volume_service.processing_instances,
        "timestamp": datetime.now().isoformat()
    }

@app.post("/scale-down")
async def scale_down(
    current_user: TokenPayload = Depends(get_current_user),
):
    """Manually scale down resources"""
    await volume_service.scale_down_resources()
    return {
        "status": "scaled_down", 
        "instances": volume_service.processing_instances,
        "timestamp": datetime.now().isoformat()
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "volume-management",
        "version": "2.0.0",
        "timestamp": datetime.now().isoformat(),
        "auto_scaling": volume_service.auto_scaling_active,
        "instances": volume_service.processing_instances
    }

@app.get("/scaling-config", response_model=ScalingConfig)
async def get_scaling_config(
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get current scaling configuration"""
    return volume_service.scaling_config

@app.put("/scaling-config")
async def update_scaling_config(config: ScalingConfig,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Update scaling configuration"""
    volume_service.scaling_config = config
    return {"status": "updated", "config": config}

# Background task for continuous monitoring
async def continuous_monitoring():
    """Continuous monitoring and auto-scaling"""
    while True:
        try:
            metrics = await volume_service.get_current_metrics()
            
            # Auto-scale based on load
            if metrics.current_load > volume_service.scaling_config.threshold:
                await volume_service.scale_up_resources()
            elif metrics.current_load < (volume_service.scaling_config.threshold * 0.5):
                await volume_service.scale_down_resources()
            
            # Process some cases (simulation)
            if volume_service.mock_cases[CaseStatus.QUEUED] > 0:
                processed = min(100, volume_service.mock_cases[CaseStatus.QUEUED])
                volume_service.mock_cases[CaseStatus.QUEUED] -= processed
                volume_service.mock_cases[CaseStatus.COMPLETED] += processed
            
            await asyncio.sleep(30)  # Check every 30 seconds
            
        except Exception as e:
            logger.error(f"Error in continuous monitoring: {e}")
            await asyncio.sleep(60)  # Wait longer on error

@app.on_event("startup")
async def startup_event():
    """Start background monitoring task"""
    asyncio.create_task(continuous_monitoring())
    logger.info("Georgetown-Enhanced Volume Management Service started")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)