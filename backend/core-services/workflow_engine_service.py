"""
Healthcare Claims Platform - Workflow Engine Service
Advanced workflow orchestration with Temporal-like capabilities for healthcare claims processing.

Author: Manus AI
Date: October 8, 2025
Port: 8011
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

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, status
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
from contextlib import asynccontextmanager
import httpx
from dataclasses import dataclass, field
from collections import defaultdict, deque
import time

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

class WorkflowStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    PAUSED = "paused"
    RETRYING = "retrying"

class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"
    RETRYING = "retrying"

class WorkflowType(str, Enum):
    CLAIMS_PROCESSING = "claims_processing"
    FRAUD_DETECTION = "fraud_detection"
    PROVIDER_ONBOARDING = "provider_onboarding"
    PATIENT_REGISTRATION = "patient_registration"
    COMPLIANCE_CHECK = "compliance_check"
    BILLING_WORKFLOW = "billing_workflow"
    DOCUMENT_VERIFICATION = "document_verification"
    NSA_IDR_WORKFLOW = "nsa_idr_workflow"

class TaskType(str, Enum):
    HTTP_REQUEST = "http_request"
    DATABASE_OPERATION = "database_operation"
    FILE_PROCESSING = "file_processing"
    AI_INFERENCE = "ai_inference"
    NOTIFICATION = "notification"
    APPROVAL = "approval"
    DELAY = "delay"
    CONDITION = "condition"
    PARALLEL_EXECUTION = "parallel_execution"

# Pydantic Models
class TaskDefinition(BaseModel):
    id: str
    name: str
    task_type: TaskType
    parameters: Dict[str, Any] = {}
    retry_count: int = Field(default=3, ge=0, le=10)
    timeout_seconds: int = Field(default=300, ge=1, le=3600)
    depends_on: List[str] = []
    condition: Optional[str] = None
    on_success: List[str] = []
    on_failure: List[str] = []

class WorkflowDefinition(BaseModel):
    id: str
    name: str
    description: str
    workflow_type: WorkflowType
    version: str = "1.0.0"
    tasks: List[TaskDefinition]
    global_timeout_seconds: int = Field(default=3600, ge=60, le=86400)
    max_retries: int = Field(default=3, ge=0, le=10)
    created_by: str
    tenant_id: str

class WorkflowInstance(BaseModel):
    id: str
    workflow_definition_id: str
    status: WorkflowStatus
    input_data: Dict[str, Any] = {}
    output_data: Dict[str, Any] = {}
    current_task: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    retry_count: int = 0
    tenant_id: str
    created_by: str

class TaskInstance(BaseModel):
    id: str
    workflow_instance_id: str
    task_definition_id: str
    status: TaskStatus
    input_data: Dict[str, Any] = {}
    output_data: Dict[str, Any] = {}
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    retry_count: int = 0

class WorkflowExecutionRequest(BaseModel):
    workflow_definition_id: str
    input_data: Dict[str, Any] = {}
    priority: int = Field(default=5, ge=1, le=10)
    tenant_id: str
    created_by: str

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
                CREATE TABLE IF NOT EXISTS workflow_definitions (
                    id UUID PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    workflow_type VARCHAR(50) NOT NULL,
                    version VARCHAR(20) NOT NULL,
                    definition_json JSONB NOT NULL,
                    global_timeout_seconds INTEGER NOT NULL,
                    max_retries INTEGER NOT NULL,
                    created_by VARCHAR(255) NOT NULL,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    is_active BOOLEAN DEFAULT TRUE
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS workflow_instances (
                    id UUID PRIMARY KEY,
                    workflow_definition_id UUID NOT NULL,
                    status VARCHAR(20) NOT NULL,
                    input_data JSONB,
                    output_data JSONB,
                    current_task VARCHAR(255),
                    started_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    error_message TEXT,
                    retry_count INTEGER DEFAULT 0,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_by VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (workflow_definition_id) REFERENCES workflow_definitions(id)
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS task_instances (
                    id UUID PRIMARY KEY,
                    workflow_instance_id UUID NOT NULL,
                    task_definition_id VARCHAR(255) NOT NULL,
                    status VARCHAR(20) NOT NULL,
                    input_data JSONB,
                    output_data JSONB,
                    started_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    error_message TEXT,
                    retry_count INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (workflow_instance_id) REFERENCES workflow_instances(id)
                );
            """)
            
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_workflow_instances_status ON workflow_instances(status);
                CREATE INDEX IF NOT EXISTS idx_workflow_instances_tenant ON workflow_instances(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_task_instances_status ON task_instances(status);
                CREATE INDEX IF NOT EXISTS idx_task_instances_workflow ON task_instances(workflow_instance_id);
            """)

db_manager = DatabaseManager()

# Workflow Engine
class WorkflowEngine:
    def __init__(self):
        self.redis_client = None
        self.running_workflows = {}
        self.task_executors = {
            TaskType.HTTP_REQUEST: self._execute_http_request,
            TaskType.DATABASE_OPERATION: self._execute_database_operation,
            TaskType.FILE_PROCESSING: self._execute_file_processing,
            TaskType.AI_INFERENCE: self._execute_ai_inference,
            TaskType.NOTIFICATION: self._execute_notification,
            TaskType.APPROVAL: self._execute_approval,
            TaskType.DELAY: self._execute_delay,
            TaskType.CONDITION: self._execute_condition,
            TaskType.PARALLEL_EXECUTION: self._execute_parallel_execution,
        }

    async def _get_redis_client(self):
        if not self.redis_client:
            self.redis_client = get_redis_client()
        return self.redis_client

    async def create_workflow_definition(self, definition: WorkflowDefinition) -> str:
        """Create a new workflow definition"""
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO workflow_definitions 
                (id, name, description, workflow_type, version, definition_json, 
                 global_timeout_seconds, max_retries, created_by, tenant_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """, 
            definition.id, definition.name, definition.description, 
            definition.workflow_type.value, definition.version, 
            json.dumps(definition.dict()), definition.global_timeout_seconds,
            definition.max_retries, definition.created_by, definition.tenant_id)
        
        logger.info(f"Created workflow definition: {definition.id}")
        return definition.id

    async def start_workflow(self, request: WorkflowExecutionRequest) -> str:
        """Start a new workflow instance"""
        workflow_instance_id = str(uuid.uuid4())
        
        # Get workflow definition
        async with db_manager.pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT definition_json FROM workflow_definitions 
                WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE
            """, request.workflow_definition_id, request.tenant_id)
            
            if not row:
                raise HTTPException(status_code=404, detail="Workflow definition not found")
            
            definition_data = row['definition_json']
            workflow_definition = WorkflowDefinition(**definition_data)
        
        # Create workflow instance
        workflow_instance = WorkflowInstance(
            id=workflow_instance_id,
            workflow_definition_id=request.workflow_definition_id,
            status=WorkflowStatus.PENDING,
            input_data=request.input_data,
            tenant_id=request.tenant_id,
            created_by=request.created_by
        )
        
        await self._save_workflow_instance(workflow_instance)
        
        # Start execution in background
        asyncio.create_task(self._execute_workflow(workflow_instance, workflow_definition))
        
        logger.info(f"Started workflow instance: {workflow_instance_id}")
        return workflow_instance_id

    async def _execute_workflow(self, instance: WorkflowInstance, definition: WorkflowDefinition):
        """Execute a workflow instance"""
        try:
            instance.status = WorkflowStatus.RUNNING
            instance.started_at = datetime.utcnow()
            await self._save_workflow_instance(instance)
            
            # Build task dependency graph
            task_graph = self._build_task_graph(definition.tasks)
            
            # Execute tasks based on dependencies
            completed_tasks = set()
            failed_tasks = set()
            
            while len(completed_tasks) + len(failed_tasks) < len(definition.tasks):
                # Find ready tasks (all dependencies completed)
                ready_tasks = []
                for task in definition.tasks:
                    if (task.id not in completed_tasks and 
                        task.id not in failed_tasks and
                        all(dep in completed_tasks for dep in task.depends_on)):
                        ready_tasks.append(task)
                
                if not ready_tasks:
                    # Check if we're stuck due to failed dependencies
                    remaining_tasks = [t for t in definition.tasks 
                                     if t.id not in completed_tasks and t.id not in failed_tasks]
                    if remaining_tasks:
                        instance.status = WorkflowStatus.FAILED
                        instance.error_message = "Workflow stuck due to failed dependencies"
                        break
                    else:
                        break
                
                # Execute ready tasks
                task_results = await asyncio.gather(
                    *[self._execute_task(instance.id, task, instance.input_data) 
                      for task in ready_tasks],
                    return_exceptions=True
                )
                
                # Process results
                for task, result in zip(ready_tasks, task_results):
                    if isinstance(result, Exception):
                        failed_tasks.add(task.id)
                        logger.error(f"Task {task.id} failed: {result}")
                    else:
                        completed_tasks.add(task.id)
                        # Update instance data with task output
                        if result:
                            instance.output_data.update(result)
            
            # Determine final status
            if failed_tasks:
                instance.status = WorkflowStatus.FAILED
                instance.error_message = f"Tasks failed: {', '.join(failed_tasks)}"
            else:
                instance.status = WorkflowStatus.COMPLETED
            
            instance.completed_at = datetime.utcnow()
            await self._save_workflow_instance(instance)
            
        except Exception as e:
            logger.error(f"Workflow execution failed: {e}")
            instance.status = WorkflowStatus.FAILED
            instance.error_message = str(e)
            instance.completed_at = datetime.utcnow()
            await self._save_workflow_instance(instance)

    def _build_task_graph(self, tasks: List[TaskDefinition]) -> Dict[str, List[str]]:
        """Build task dependency graph"""
        graph = defaultdict(list)
        for task in tasks:
            for dependency in task.depends_on:
                graph[dependency].append(task.id)
        return dict(graph)

    async def _execute_task(self, workflow_instance_id: str, task: TaskDefinition, 
                           workflow_data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a single task"""
        task_instance = TaskInstance(
            id=str(uuid.uuid4()),
            workflow_instance_id=workflow_instance_id,
            task_definition_id=task.id,
            status=TaskStatus.RUNNING,
            input_data=workflow_data,
            started_at=datetime.utcnow()
        )
        
        await self._save_task_instance(task_instance)
        
        try:
            # Execute task based on type
            executor = self.task_executors.get(task.task_type)
            if not executor:
                raise ValueError(f"Unknown task type: {task.task_type}")
            
            result = await executor(task, workflow_data)
            
            task_instance.status = TaskStatus.COMPLETED
            task_instance.output_data = result
            task_instance.completed_at = datetime.utcnow()
            
        except Exception as e:
            task_instance.status = TaskStatus.FAILED
            task_instance.error_message = str(e)
            task_instance.completed_at = datetime.utcnow()
            raise
        
        finally:
            await self._save_task_instance(task_instance)
        
        return task_instance.output_data

    # Task Executors
    async def _execute_http_request(self, task: TaskDefinition, data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute HTTP request task"""
        params = task.parameters
        url = params.get('url')
        method = params.get('method', 'GET').upper()
        headers = params.get('headers', {})
        payload = params.get('payload', {})
        
        # Template substitution
        for key, value in payload.items():
            if isinstance(value, str) and value.startswith('${') and value.endswith('}'):
                field_name = value[2:-1]
                payload[key] = data.get(field_name, value)
        
        async with httpx.AsyncClient() as client:
            response = await client.request(method, url, headers=headers, json=payload)
            response.raise_for_status()
            
            return {
                'status_code': response.status_code,
                'response_data': response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text,
                'headers': dict(response.headers)
            }

    async def _execute_database_operation(self, task: TaskDefinition, data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute database operation task"""
        params = task.parameters
        operation = params.get('operation')  # 'select', 'insert', 'update', 'delete'
        query = params.get('query')
        parameters = params.get('parameters', [])
        
        # Template substitution for parameters
        resolved_params = []
        for param in parameters:
            if isinstance(param, str) and param.startswith('${') and param.endswith('}'):
                field_name = param[2:-1]
                resolved_params.append(data.get(field_name, param))
            else:
                resolved_params.append(param)
        
        async with db_manager.pool.acquire() as conn:
            if operation == 'select':
                rows = await conn.fetch(query, *resolved_params)
                return {'rows': [dict(row) for row in rows]}
            else:
                result = await conn.execute(query, *resolved_params)
                return {'affected_rows': result}

    async def _execute_file_processing(self, task: TaskDefinition, data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute file processing task"""
        params = task.parameters
        operation = params.get('operation')  # 'read', 'write', 'process'
        file_path = params.get('file_path')
        
        if operation == 'read':
            with open(file_path, 'r') as f:
                content = f.read()
            return {'file_content': content}
        elif operation == 'write':
            content = params.get('content', '')
            with open(file_path, 'w') as f:
                f.write(content)
            return {'bytes_written': len(content)}
        
        return {}

    async def _execute_ai_inference(self, task: TaskDefinition, data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute AI inference task"""
        params = task.parameters
        service_url = params.get('service_url', 'http://localhost:8001')
        endpoint = params.get('endpoint', '/detect-fraud')
        input_data = params.get('input_data', {})
        
        # Resolve input data from workflow context
        for key, value in input_data.items():
            if isinstance(value, str) and value.startswith('${') and value.endswith('}'):
                field_name = value[2:-1]
                input_data[key] = data.get(field_name, value)
        
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{service_url}{endpoint}", json=input_data)
            response.raise_for_status()
            return response.json()

    async def _execute_notification(self, task: TaskDefinition, data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute notification task"""
        params = task.parameters
        notification_type = params.get('type', 'email')
        recipients = params.get('recipients', [])
        message = params.get('message', '')
        
        # Template substitution
        for key, value in data.items():
            message = message.replace(f"${{{key}}}", str(value))
        
        # Call notification service
        async with httpx.AsyncClient() as client:
            response = await client.post('http://localhost:8006/send-notification', json={
                'type': notification_type,
                'recipients': recipients,
                'message': message
            })
            response.raise_for_status()
            return response.json()

    async def _execute_approval(self, task: TaskDefinition, data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute approval task (human-in-the-loop)"""
        params = task.parameters
        approvers = params.get('approvers', [])
        timeout_hours = params.get('timeout_hours', 24)
        
        # Create approval request
        approval_id = str(uuid.uuid4())
        redis_client = await self._get_redis_client()
        
        approval_data = {
            'id': approval_id,
            'task_id': task.id,
            'approvers': approvers,
            'data': data,
            'created_at': datetime.utcnow().isoformat(),
            'status': 'pending'
        }
        
        await redis_client.setex(
            f"approval:{approval_id}", 
            timeout_hours * 3600, 
            json.dumps(approval_data)
        )
        
        # Wait for approval (simplified - in production, use proper async mechanisms)
        timeout = time.time() + (timeout_hours * 3600)
        while time.time() < timeout:
            approval_status = await redis_client.get(f"approval_status:{approval_id}")
            if approval_status:
                status_data = json.loads(approval_status)
                return status_data
            await asyncio.sleep(30)  # Check every 30 seconds
        
        raise TimeoutError("Approval timeout exceeded")

    async def _execute_delay(self, task: TaskDefinition, data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute delay task"""
        params = task.parameters
        delay_seconds = params.get('delay_seconds', 60)
        await asyncio.sleep(delay_seconds)
        return {'delayed_for': delay_seconds}

    async def _execute_condition(self, task: TaskDefinition, data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute conditional task"""
        params = task.parameters
        condition = params.get('condition')
        
        # Simple condition evaluation (in production, use a proper expression evaluator)
        if condition:
            # Replace variables in condition
            for key, value in data.items():
                condition = condition.replace(f"${{{key}}}", str(value))
            
            # Evaluate condition (simplified)
            result = eval(condition)  # WARNING: Use a safe evaluator in production
            return {'condition_result': result}
        
        return {'condition_result': True}

    async def _execute_parallel_execution(self, task: TaskDefinition, data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute parallel tasks"""
        params = task.parameters
        parallel_tasks = params.get('tasks', [])
        
        # Execute all tasks in parallel
        results = await asyncio.gather(
            *[self._execute_task(data.get('workflow_instance_id'), 
                                TaskDefinition(**task_def), data) 
              for task_def in parallel_tasks],
            return_exceptions=True
        )
        
        return {'parallel_results': results}

    async def _save_workflow_instance(self, instance: WorkflowInstance):
        """Save workflow instance to database"""
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO workflow_instances 
                (id, workflow_definition_id, status, input_data, output_data, 
                 current_task, started_at, completed_at, error_message, retry_count, 
                 tenant_id, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (id) DO UPDATE SET
                    status = EXCLUDED.status,
                    output_data = EXCLUDED.output_data,
                    current_task = EXCLUDED.current_task,
                    started_at = EXCLUDED.started_at,
                    completed_at = EXCLUDED.completed_at,
                    error_message = EXCLUDED.error_message,
                    retry_count = EXCLUDED.retry_count,
                    updated_at = NOW()
            """, 
            instance.id, instance.workflow_definition_id, instance.status.value,
            json.dumps(instance.input_data), json.dumps(instance.output_data),
            instance.current_task, instance.started_at, instance.completed_at,
            instance.error_message, instance.retry_count, instance.tenant_id,
            instance.created_by)

    async def _save_task_instance(self, instance: TaskInstance):
        """Save task instance to database"""
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO task_instances 
                (id, workflow_instance_id, task_definition_id, status, input_data, 
                 output_data, started_at, completed_at, error_message, retry_count)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (id) DO UPDATE SET
                    status = EXCLUDED.status,
                    output_data = EXCLUDED.output_data,
                    started_at = EXCLUDED.started_at,
                    completed_at = EXCLUDED.completed_at,
                    error_message = EXCLUDED.error_message,
                    retry_count = EXCLUDED.retry_count,
                    updated_at = NOW()
            """, 
            instance.id, instance.workflow_instance_id, instance.task_definition_id,
            instance.status.value, json.dumps(instance.input_data), 
            json.dumps(instance.output_data), instance.started_at, 
            instance.completed_at, instance.error_message, instance.retry_count)

workflow_engine = WorkflowEngine()

# Lifespan manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_manager.connect()
    yield
    await db_manager.disconnect()

app = FastAPI(
    title="Healthcare Claims Platform - Workflow Engine Service",
    description="Advanced workflow orchestration with Temporal-like capabilities",
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
@app.post("/workflow-definitions", status_code=status.HTTP_201_CREATED)
async def create_workflow_definition(definition: WorkflowDefinition,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create a new workflow definition"""
    definition.id = str(uuid.uuid4())
    workflow_id = await workflow_engine.create_workflow_definition(definition)
    return {"workflow_definition_id": workflow_id}

@app.post("/workflows/start", status_code=status.HTTP_201_CREATED)
async def start_workflow(request: WorkflowExecutionRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Start a new workflow instance"""
    instance_id = await workflow_engine.start_workflow(request)
    return {"workflow_instance_id": instance_id}

@app.get("/workflows/{instance_id}")
async def get_workflow_status(instance_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get workflow instance status"""
    async with db_manager.pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT * FROM workflow_instances WHERE id = $1
        """, instance_id)
        
        if not row:
            raise HTTPException(status_code=404, detail="Workflow instance not found")
        
        return dict(row)

@app.get("/workflows/{instance_id}/tasks")
async def get_workflow_tasks(instance_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get all tasks for a workflow instance"""
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT * FROM task_instances 
            WHERE workflow_instance_id = $1 
            ORDER BY created_at
        """, instance_id)
        
        return [dict(row) for row in rows]

@app.post("/workflows/{instance_id}/cancel")
async def cancel_workflow(instance_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Cancel a running workflow"""
    async with db_manager.pool.acquire() as conn:
        await conn.execute("""
            UPDATE workflow_instances 
            SET status = 'cancelled', completed_at = NOW() 
            WHERE id = $1 AND status IN ('pending', 'running')
        """, instance_id)
    
    return {"message": "Workflow cancelled"}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "workflow-engine"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8011)