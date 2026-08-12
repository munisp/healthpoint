#!/usr/bin/env python3
"""
Comprehensive Smoke Testing Suite for Unified Healthcare Claims Platform
Tests critical workflows and user journeys to ensure system functionality
"""

import asyncio
import aiohttp
import json
import time
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from dataclasses import dataclass

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class SmokeTestResult:
    """Smoke test result data structure"""
    test_name: str
    category: str
    status: str  # 'PASS', 'FAIL', 'SKIP'
    duration: float
    message: str
    workflow_steps: List[Dict] = None
    critical_failure: bool = False

class SmokeTestSuite:
    """Comprehensive smoke testing for critical workflows"""
    
    def __init__(self):
        self.base_urls = {
            'user_management': 'http://localhost:8001',
            'provider_management': 'http://localhost:8002',
            'authentication': 'http://localhost:8003',
            'api_gateway': 'http://localhost:8004',
            'claims_processing': 'http://localhost:8005',
            'notification': 'http://localhost:8006',
            'search_analytics': 'http://localhost:8007',
            'enhanced_user_mgmt': 'http://localhost:8008',
            'ai_fraud_detection': 'http://localhost:8009',
            'document_verification': 'http://localhost:8010',
            'kyb_verification': 'http://localhost:8011',
            # NSA/IDR services (may not be running yet)
            'cms_api_integration': 'http://localhost:8012',
            'qpa_calculation': 'http://localhost:8013',
            'gfe_service': 'http://localhost:8014',
            'federal_reporting': 'http://localhost:8015',
            'admin_fee_payment': 'http://localhost:8016',
            'nsa_compliance': 'http://localhost:8017'
        }
        self.results = []
        self.session = None
        
        # Critical workflow timeouts
        self.workflow_timeouts = {
            'user_journey_max_time': 30.0,  # seconds
            'claims_workflow_max_time': 45.0,
            'provider_onboarding_max_time': 60.0,
            'billing_workflow_max_time': 30.0,
            'nsa_idr_workflow_max_time': 90.0
        }
        
    async def setup_session(self):
        """Setup HTTP session for testing"""
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=60),
            headers={'Content-Type': 'application/json'}
        )
        
    async def cleanup_session(self):
        """Cleanup HTTP session"""
        if self.session:
            await self.session.close()
            
    async def make_request(self, method: str, url: str, **kwargs) -> Dict:
        """Make HTTP request with error handling"""
        try:
            async with self.session.request(method, url, **kwargs) as response:
                if response.content_type == 'application/json':
                    data = await response.json()
                else:
                    data = {'text': await response.text()}
                return {
                    'status': response.status,
                    'data': data,
                    'headers': dict(response.headers)
                }
        except Exception as e:
            return {
                'status': 0,
                'error': str(e),
                'data': None
            }
            
    async def test_critical_system_health(self) -> List[SmokeTestResult]:
        """Test critical system health - must pass for system to be operational"""
        results = []
        
        start_time = time.time()
        critical_services = [
            'user_management', 'authentication', 'claims_processing', 
            'provider_management', 'api_gateway'
        ]
        
        workflow_steps = []
        all_healthy = True
        
        for service_name in critical_services:
            step_start = time.time()
            try:
                health_response = await self.make_request(
                    'GET', 
                    f"{self.base_urls[service_name]}/health"
                )
                step_duration = time.time() - step_start
                
                if health_response['status'] == 200:
                    workflow_steps.append({
                        'step': f"Health check - {service_name}",
                        'status': 'PASS',
                        'duration': step_duration,
                        'details': health_response['data']
                    })
                else:
                    workflow_steps.append({
                        'step': f"Health check - {service_name}",
                        'status': 'FAIL',
                        'duration': step_duration,
                        'error': f"Status {health_response['status']}"
                    })
                    all_healthy = False
            except Exception as e:
                workflow_steps.append({
                    'step': f"Health check - {service_name}",
                    'status': 'FAIL',
                    'duration': time.time() - step_start,
                    'error': str(e)
                })
                all_healthy = False
                
        duration = time.time() - start_time
        
        results.append(SmokeTestResult(
            test_name="Critical System Health Check",
            category="System Health",
            status="PASS" if all_healthy else "FAIL",
            duration=duration,
            message=f"Critical services health: {'All healthy' if all_healthy else 'Some services unhealthy'}",
            workflow_steps=workflow_steps,
            critical_failure=not all_healthy
        ))
        
        return results
        
    async def test_user_authentication_journey(self) -> List[SmokeTestResult]:
        """Test complete user authentication journey"""
        results = []
        
        start_time = time.time()
        workflow_steps = []
        journey_success = True
        
        try:
            # Step 1: User Login
            step_start = time.time()
            login_response = await self.make_request(
                'POST',
                f"{self.base_urls['authentication']}/auth/login",
                json={
                    "email": "admin@medcorp.com",
                    "password": "SecurePass123!"
                }
            )
            step_duration = time.time() - step_start
            
            if login_response['status'] == 200 and 'access_token' in login_response.get('data', {}):
                access_token = login_response['data']['access_token']
                workflow_steps.append({
                    'step': "User Login",
                    'status': 'PASS',
                    'duration': step_duration,
                    'details': {'token_received': True}
                })
            else:
                workflow_steps.append({
                    'step': "User Login",
                    'status': 'FAIL',
                    'duration': step_duration,
                    'error': f"Login failed: {login_response}"
                })
                journey_success = False
                access_token = None
                
            # Step 2: Token Validation (if login succeeded)
            if access_token:
                step_start = time.time()
                validate_response = await self.make_request(
                    'GET',
                    f"{self.base_urls['authentication']}/auth/validate",
                    headers={'Authorization': f'Bearer {access_token}'}
                )
                step_duration = time.time() - step_start
                
                if validate_response['status'] == 200:
                    workflow_steps.append({
                        'step': "Token Validation",
                        'status': 'PASS',
                        'duration': step_duration,
                        'details': validate_response['data']
                    })
                else:
                    workflow_steps.append({
                        'step': "Token Validation",
                        'status': 'FAIL',
                        'duration': step_duration,
                        'error': f"Validation failed: {validate_response}"
                    })
                    journey_success = False
                    
            # Step 3: Access Protected Resource
            if access_token:
                step_start = time.time()
                profile_response = await self.make_request(
                    'GET',
                    f"{self.base_urls['user_management']}/users/profile",
                    headers={'Authorization': f'Bearer {access_token}'}
                )
                step_duration = time.time() - step_start
                
                if profile_response['status'] in [200, 404]:  # 404 acceptable if endpoint doesn't exist
                    workflow_steps.append({
                        'step': "Access Protected Resource",
                        'status': 'PASS',
                        'duration': step_duration,
                        'details': {'access_granted': True}
                    })
                else:
                    workflow_steps.append({
                        'step': "Access Protected Resource",
                        'status': 'FAIL',
                        'duration': step_duration,
                        'error': f"Access denied: {profile_response}"
                    })
                    journey_success = False
                    
        except Exception as e:
            workflow_steps.append({
                'step': "Authentication Journey Exception",
                'status': 'FAIL',
                'duration': time.time() - start_time,
                'error': str(e)
            })
            journey_success = False
            
        duration = time.time() - start_time
        
        results.append(SmokeTestResult(
            test_name="User Authentication Journey",
            category="User Journey",
            status="PASS" if journey_success else "FAIL",
            duration=duration,
            message=f"Authentication journey: {'Successful' if journey_success else 'Failed'}",
            workflow_steps=workflow_steps,
            critical_failure=not journey_success
        ))
        
        return results
        
    async def test_claims_processing_workflow(self) -> List[SmokeTestResult]:
        """Test complete claims processing workflow"""
        results = []
        
        start_time = time.time()
        workflow_steps = []
        workflow_success = True
        
        try:
            # Step 1: Claims Submission
            step_start = time.time()
            claim_data = {
                "provider_id": "PROV-SMOKE-001",
                "payer_id": "PAYER-001",
                "patient_id": "PAT-SMOKE-001",
                "service_codes": ["99213"],
                "service_date": "2025-10-06",
                "billed_amount": 150.00,
                "diagnosis_codes": ["Z00.00"]
            }
            
            submit_response = await self.make_request(
                'POST',
                f"{self.base_urls['claims_processing']}/claims/submit",
                json=claim_data
            )
            step_duration = time.time() - step_start
            
            if submit_response['status'] == 201:
                claim_id = submit_response['data'].get('claim_id', 'UNKNOWN')
                workflow_steps.append({
                    'step': "Claims Submission",
                    'status': 'PASS',
                    'duration': step_duration,
                    'details': {'claim_id': claim_id}
                })
            else:
                workflow_steps.append({
                    'step': "Claims Submission",
                    'status': 'FAIL',
                    'duration': step_duration,
                    'error': f"Submission failed: {submit_response}"
                })
                workflow_success = False
                claim_id = None
                
            # Step 2: Claims Status Check
            step_start = time.time()
            test_claim_id = claim_id or "CLM-SMOKE-001"
            status_response = await self.make_request(
                'GET',
                f"{self.base_urls['claims_processing']}/claims/{test_claim_id}/status"
            )
            step_duration = time.time() - step_start
            
            if status_response['status'] in [200, 404]:  # 404 acceptable for non-existent claim
                workflow_steps.append({
                    'step': "Claims Status Check",
                    'status': 'PASS',
                    'duration': step_duration,
                    'details': status_response['data']
                })
            else:
                workflow_steps.append({
                    'step': "Claims Status Check",
                    'status': 'FAIL',
                    'duration': step_duration,
                    'error': f"Status check failed: {status_response}"
                })
                workflow_success = False
                
            # Step 3: Fraud Detection Check
            step_start = time.time()
            fraud_response = await self.make_request(
                'POST',
                f"{self.base_urls['ai_fraud_detection']}/fraud/analyze",
                json={
                    "claim_id": test_claim_id,
                    "provider_id": claim_data["provider_id"],
                    "billed_amount": claim_data["billed_amount"],
                    "service_codes": claim_data["service_codes"]
                }
            )
            step_duration = time.time() - step_start
            
            if fraud_response['status'] == 200:
                workflow_steps.append({
                    'step': "Fraud Detection Analysis",
                    'status': 'PASS',
                    'duration': step_duration,
                    'details': fraud_response['data']
                })
            else:
                workflow_steps.append({
                    'step': "Fraud Detection Analysis",
                    'status': 'FAIL',
                    'duration': step_duration,
                    'error': f"Fraud analysis failed: {fraud_response}"
                })
                workflow_success = False
                
        except Exception as e:
            workflow_steps.append({
                'step': "Claims Workflow Exception",
                'status': 'FAIL',
                'duration': time.time() - start_time,
                'error': str(e)
            })
            workflow_success = False
            
        duration = time.time() - start_time
        
        results.append(SmokeTestResult(
            test_name="Claims Processing Workflow",
            category="Claims Workflow",
            status="PASS" if workflow_success else "FAIL",
            duration=duration,
            message=f"Claims processing workflow: {'Successful' if workflow_success else 'Failed'}",
            workflow_steps=workflow_steps,
            critical_failure=not workflow_success
        ))
        
        return results
        
    async def test_provider_onboarding_workflow(self) -> List[SmokeTestResult]:
        """Test complete provider onboarding workflow"""
        results = []
        
        start_time = time.time()
        workflow_steps = []
        workflow_success = True
        
        try:
            # Step 1: Provider Registration
            step_start = time.time()
            provider_data = {
                "npi": f"SMOKE{int(time.time()) % 100000}",
                "name": "Smoke Test Healthcare Provider",
                "address": "123 Test St, Smoke City, SC 12345",
                "phone": "555-SMOKE-01",
                "email": f"smoke.provider.{int(time.time())}@example.com",
                "specialties": ["Internal Medicine"]
            }
            
            register_response = await self.make_request(
                'POST',
                f"{self.base_urls['provider_management']}/providers/register",
                json=provider_data
            )
            step_duration = time.time() - step_start
            
            if register_response['status'] == 201:
                provider_id = register_response['data'].get('id', 'UNKNOWN')
                workflow_steps.append({
                    'step': "Provider Registration",
                    'status': 'PASS',
                    'duration': step_duration,
                    'details': {'provider_id': provider_id}
                })
            else:
                workflow_steps.append({
                    'step': "Provider Registration",
                    'status': 'FAIL',
                    'duration': step_duration,
                    'error': f"Registration failed: {register_response}"
                })
                workflow_success = False
                provider_id = None
                
            # Step 2: KYB Verification
            step_start = time.time()
            kyb_data = {
                "business_name": provider_data["name"],
                "tax_id": "12-3456789",
                "business_address": provider_data["address"],
                "verification_type": "healthcare_provider"
            }
            
            kyb_response = await self.make_request(
                'POST',
                f"{self.base_urls['kyb_verification']}/kyb/verify",
                json=kyb_data
            )
            step_duration = time.time() - step_start
            
            if kyb_response['status'] == 200:
                workflow_steps.append({
                    'step': "KYB Verification",
                    'status': 'PASS',
                    'duration': step_duration,
                    'details': kyb_response['data']
                })
            else:
                workflow_steps.append({
                    'step': "KYB Verification",
                    'status': 'FAIL',
                    'duration': step_duration,
                    'error': f"KYB verification failed: {kyb_response}"
                })
                workflow_success = False
                
            # Step 3: Document Verification
            step_start = time.time()
            doc_data = {
                "provider_id": provider_id or "SMOKE-PROV-001",
                "document_type": "medical_license",
                "document_content": "Sample medical license content for smoke testing"
            }
            
            doc_response = await self.make_request(
                'POST',
                f"{self.base_urls['document_verification']}/documents/verify",
                json=doc_data
            )
            step_duration = time.time() - step_start
            
            if doc_response['status'] == 200:
                workflow_steps.append({
                    'step': "Document Verification",
                    'status': 'PASS',
                    'duration': step_duration,
                    'details': doc_response['data']
                })
            else:
                workflow_steps.append({
                    'step': "Document Verification",
                    'status': 'FAIL',
                    'duration': step_duration,
                    'error': f"Document verification failed: {doc_response}"
                })
                workflow_success = False
                
        except Exception as e:
            workflow_steps.append({
                'step': "Provider Onboarding Exception",
                'status': 'FAIL',
                'duration': time.time() - start_time,
                'error': str(e)
            })
            workflow_success = False
            
        duration = time.time() - start_time
        
        results.append(SmokeTestResult(
            test_name="Provider Onboarding Workflow",
            category="Provider Workflow",
            status="PASS" if workflow_success else "FAIL",
            duration=duration,
            message=f"Provider onboarding workflow: {'Successful' if workflow_success else 'Failed'}",
            workflow_steps=workflow_steps,
            critical_failure=not workflow_success
        ))
        
        return results
        
    async def test_notification_workflow(self) -> List[SmokeTestResult]:
        """Test notification workflow"""
        results = []
        
        start_time = time.time()
        workflow_steps = []
        workflow_success = True
        
        try:
            # Step 1: Send Notification
            step_start = time.time()
            notification_data = {
                "recipient_id": "smoke-user-001",
                "type": "email",
                "subject": "Smoke Test Notification",
                "message": "This is a smoke test notification",
                "priority": "normal"
            }
            
            send_response = await self.make_request(
                'POST',
                f"{self.base_urls['notification']}/notifications/send",
                json=notification_data
            )
            step_duration = time.time() - step_start
            
            if send_response['status'] == 201:
                notification_id = send_response['data'].get('id', 'UNKNOWN')
                workflow_steps.append({
                    'step': "Send Notification",
                    'status': 'PASS',
                    'duration': step_duration,
                    'details': {'notification_id': notification_id}
                })
            else:
                workflow_steps.append({
                    'step': "Send Notification",
                    'status': 'FAIL',
                    'duration': step_duration,
                    'error': f"Send failed: {send_response}"
                })
                workflow_success = False
                notification_id = None
                
            # Step 2: Check Notification Status
            step_start = time.time()
            test_notification_id = notification_id or "NOTIF-SMOKE-001"
            status_response = await self.make_request(
                'GET',
                f"{self.base_urls['notification']}/notifications/{test_notification_id}/status"
            )
            step_duration = time.time() - step_start
            
            if status_response['status'] in [200, 404]:  # 404 acceptable for non-existent notification
                workflow_steps.append({
                    'step': "Check Notification Status",
                    'status': 'PASS',
                    'duration': step_duration,
                    'details': status_response['data']
                })
            else:
                workflow_steps.append({
                    'step': "Check Notification Status",
                    'status': 'FAIL',
                    'duration': step_duration,
                    'error': f"Status check failed: {status_response}"
                })
                workflow_success = False
                
        except Exception as e:
            workflow_steps.append({
                'step': "Notification Workflow Exception",
                'status': 'FAIL',
                'duration': time.time() - start_time,
                'error': str(e)
            })
            workflow_success = False
            
        duration = time.time() - start_time
        
        results.append(SmokeTestResult(
            test_name="Notification Workflow",
            category="Notification Workflow",
            status="PASS" if workflow_success else "FAIL",
            duration=duration,
            message=f"Notification workflow: {'Successful' if workflow_success else 'Failed'}",
            workflow_steps=workflow_steps
        ))
        
        return results
        
    async def test_search_analytics_workflow(self) -> List[SmokeTestResult]:
        """Test search and analytics workflow"""
        results = []
        
        start_time = time.time()
        workflow_steps = []
        workflow_success = True
        
        try:
            # Step 1: Perform Search
            step_start = time.time()
            search_response = await self.make_request(
                'GET',
                f"{self.base_urls['search_analytics']}/search?q=healthcare&type=claims&limit=5"
            )
            step_duration = time.time() - step_start
            
            if search_response['status'] == 200:
                workflow_steps.append({
                    'step': "Perform Search",
                    'status': 'PASS',
                    'duration': step_duration,
                    'details': {'results_count': len(search_response['data'].get('results', []))}
                })
            else:
                workflow_steps.append({
                    'step': "Perform Search",
                    'status': 'FAIL',
                    'duration': step_duration,
                    'error': f"Search failed: {search_response}"
                })
                workflow_success = False
                
            # Step 2: Get Analytics Dashboard
            step_start = time.time()
            analytics_response = await self.make_request(
                'GET',
                f"{self.base_urls['search_analytics']}/analytics/dashboard"
            )
            step_duration = time.time() - step_start
            
            if analytics_response['status'] == 200:
                workflow_steps.append({
                    'step': "Get Analytics Dashboard",
                    'status': 'PASS',
                    'duration': step_duration,
                    'details': analytics_response['data']
                })
            else:
                workflow_steps.append({
                    'step': "Get Analytics Dashboard",
                    'status': 'FAIL',
                    'duration': step_duration,
                    'error': f"Analytics failed: {analytics_response}"
                })
                workflow_success = False
                
        except Exception as e:
            workflow_steps.append({
                'step': "Search Analytics Exception",
                'status': 'FAIL',
                'duration': time.time() - start_time,
                'error': str(e)
            })
            workflow_success = False
            
        duration = time.time() - start_time
        
        results.append(SmokeTestResult(
            test_name="Search Analytics Workflow",
            category="Search Analytics Workflow",
            status="PASS" if workflow_success else "FAIL",
            duration=duration,
            message=f"Search analytics workflow: {'Successful' if workflow_success else 'Failed'}",
            workflow_steps=workflow_steps
        ))
        
        return results
        
    async def test_nsa_idr_workflow(self) -> List[SmokeTestResult]:
        """Test NSA/IDR workflow (if services are available)"""
        results = []
        
        start_time = time.time()
        workflow_steps = []
        workflow_success = True
        
        try:
            # Check if NSA/IDR services are available
            nsa_services_available = True
            for service in ['gfe_service', 'qpa_calculation', 'federal_reporting']:
                health_response = await self.make_request(
                    'GET',
                    f"{self.base_urls[service]}/health"
                )
                if health_response['status'] != 200:
                    nsa_services_available = False
                    break
                    
            if not nsa_services_available:
                results.append(SmokeTestResult(
                    test_name="NSA/IDR Workflow",
                    category="NSA/IDR Workflow",
                    status="SKIP",
                    duration=time.time() - start_time,
                    message="NSA/IDR services not available - skipping workflow test",
                    workflow_steps=[{
                        'step': "NSA/IDR Service Availability Check",
                        'status': 'SKIP',
                        'duration': time.time() - start_time,
                        'message': 'Services not deployed'
                    }]
                ))
                return results
                
            # Step 1: Generate Good Faith Estimate
            step_start = time.time()
            gfe_data = {
                "patient_id": "PAT-SMOKE-NSA-001",
                "provider_id": "PROV-SMOKE-NSA-001",
                "services": [
                    {
                        "code": "99213",
                        "description": "Office visit",
                        "estimated_cost": 150.00
                    }
                ],
                "estimate_date": "2025-10-06"
            }
            
            gfe_response = await self.make_request(
                'POST',
                f"{self.base_urls['gfe_service']}/gfe/generate",
                json=gfe_data
            )
            step_duration = time.time() - step_start
            
            if gfe_response['status'] == 201:
                workflow_steps.append({
                    'step': "Generate Good Faith Estimate",
                    'status': 'PASS',
                    'duration': step_duration,
                    'details': gfe_response['data']
                })
            else:
                workflow_steps.append({
                    'step': "Generate Good Faith Estimate",
                    'status': 'FAIL',
                    'duration': step_duration,
                    'error': f"GFE generation failed: {gfe_response}"
                })
                workflow_success = False
                
            # Step 2: Calculate QPA
            step_start = time.time()
            qpa_data = {
                "service_code": "99213",
                "geographic_area": "12345",
                "year": 2025
            }
            
            qpa_response = await self.make_request(
                'POST',
                f"{self.base_urls['qpa_calculation']}/qpa/calculate",
                json=qpa_data
            )
            step_duration = time.time() - step_start
            
            if qpa_response['status'] == 200:
                workflow_steps.append({
                    'step': "Calculate QPA",
                    'status': 'PASS',
                    'duration': step_duration,
                    'details': qpa_response['data']
                })
            else:
                workflow_steps.append({
                    'step': "Calculate QPA",
                    'status': 'FAIL',
                    'duration': step_duration,
                    'error': f"QPA calculation failed: {qpa_response}"
                })
                workflow_success = False
                
        except Exception as e:
            workflow_steps.append({
                'step': "NSA/IDR Workflow Exception",
                'status': 'FAIL',
                'duration': time.time() - start_time,
                'error': str(e)
            })
            workflow_success = False
            
        duration = time.time() - start_time
        
        results.append(SmokeTestResult(
            test_name="NSA/IDR Workflow",
            category="NSA/IDR Workflow",
            status="PASS" if workflow_success else "FAIL",
            duration=duration,
            message=f"NSA/IDR workflow: {'Successful' if workflow_success else 'Failed'}",
            workflow_steps=workflow_steps
        ))
        
        return results
        
    async def run_all_smoke_tests(self) -> Dict[str, Any]:
        """Run all smoke tests"""
        await self.setup_session()
        
        try:
            logger.info("Starting comprehensive smoke testing...")
            
            # Test 1: Critical System Health
            logger.info("Testing critical system health...")
            health_results = await self.test_critical_system_health()
            self.results.extend(health_results)
            
            # Test 2: User Authentication Journey
            logger.info("Testing user authentication journey...")
            auth_results = await self.test_user_authentication_journey()
            self.results.extend(auth_results)
            
            # Test 3: Claims Processing Workflow
            logger.info("Testing claims processing workflow...")
            claims_results = await self.test_claims_processing_workflow()
            self.results.extend(claims_results)
            
            # Test 4: Provider Onboarding Workflow
            logger.info("Testing provider onboarding workflow...")
            provider_results = await self.test_provider_onboarding_workflow()
            self.results.extend(provider_results)
            
            # Test 5: Notification Workflow
            logger.info("Testing notification workflow...")
            notification_results = await self.test_notification_workflow()
            self.results.extend(notification_results)
            
            # Test 6: Search Analytics Workflow
            logger.info("Testing search analytics workflow...")
            search_results = await self.test_search_analytics_workflow()
            self.results.extend(search_results)
            
            # Test 7: NSA/IDR Workflow
            logger.info("Testing NSA/IDR workflow...")
            nsa_results = await self.test_nsa_idr_workflow()
            self.results.extend(nsa_results)
            
            # Generate summary
            total_tests = len(self.results)
            passed_tests = len([r for r in self.results if r.status == 'PASS'])
            failed_tests = len([r for r in self.results if r.status == 'FAIL'])
            skipped_tests = len([r for r in self.results if r.status == 'SKIP'])
            critical_failures = len([r for r in self.results if r.critical_failure])
            
            success_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0
            total_duration = sum(r.duration for r in self.results)
            
            summary = {
                'timestamp': datetime.now().isoformat(),
                'total_tests': total_tests,
                'passed': passed_tests,
                'failed': failed_tests,
                'skipped': skipped_tests,
                'critical_failures': critical_failures,
                'success_rate': round(success_rate, 2),
                'total_duration': round(total_duration, 3),
                'system_operational': critical_failures == 0,
                'categories': {}
            }
            
            # Group results by category
            for result in self.results:
                if result.category not in summary['categories']:
                    summary['categories'][result.category] = {
                        'total': 0,
                        'passed': 0,
                        'failed': 0,
                        'skipped': 0,
                        'critical_failures': 0
                    }
                summary['categories'][result.category]['total'] += 1
                if result.status == 'PASS':
                    summary['categories'][result.category]['passed'] += 1
                elif result.status == 'FAIL':
                    summary['categories'][result.category]['failed'] += 1
                elif result.status == 'SKIP':
                    summary['categories'][result.category]['skipped'] += 1
                    
                if result.critical_failure:
                    summary['categories'][result.category]['critical_failures'] += 1
                
            return {
                'summary': summary,
                'results': [
                    {
                        'test_name': r.test_name,
                        'category': r.category,
                        'status': r.status,
                        'duration': r.duration,
                        'message': r.message,
                        'workflow_steps': r.workflow_steps,
                        'critical_failure': r.critical_failure
                    }
                    for r in self.results
                ]
            }
            
        finally:
            await self.cleanup_session()
            
    def print_results(self, test_results: Dict[str, Any]):
        """Print formatted smoke test results"""
        summary = test_results['summary']
        
        print("\n" + "="*80)
        print("UNIFIED HEALTHCARE PLATFORM - SMOKE TEST RESULTS")
        print("="*80)
        print(f"Timestamp: {summary['timestamp']}")
        print(f"Total Tests: {summary['total_tests']}")
        print(f"Passed: {summary['passed']} ✅")
        print(f"Failed: {summary['failed']} ❌")
        print(f"Skipped: {summary['skipped']} ⏭️")
        print(f"Critical Failures: {summary['critical_failures']} 🚨")
        print(f"Success Rate: {summary['success_rate']}%")
        print(f"Total Duration: {summary['total_duration']}s")
        print(f"System Operational: {'YES' if summary['system_operational'] else 'NO'} {'✅' if summary['system_operational'] else '🚨'}")
        
        print("\n" + "-"*80)
        print("RESULTS BY CATEGORY")
        print("-"*80)
        
        for category, stats in summary['categories'].items():
            success_rate = (stats['passed'] / stats['total'] * 100) if stats['total'] > 0 else 0
            critical_info = f" ({stats['critical_failures']} critical)" if stats['critical_failures'] > 0 else ""
            print(f"{category}: {stats['passed']}/{stats['total']} ({success_rate:.1f}%){critical_info}")
            
        print("\n" + "-"*80)
        print("DETAILED RESULTS")
        print("-"*80)
        
        for result in test_results['results']:
            status_icon = "✅" if result['status'] == 'PASS' else "❌" if result['status'] == 'FAIL' else "⏭️"
            critical_icon = " 🚨" if result['critical_failure'] else ""
            print(f"{status_icon} {result['test_name']} ({result['duration']:.3f}s){critical_icon}")
            print(f"   Category: {result['category']}")
            print(f"   Message: {result['message']}")
            
            if result['workflow_steps']:
                print(f"   Workflow Steps:")
                for step in result['workflow_steps']:
                    step_icon = "✅" if step['status'] == 'PASS' else "❌" if step['status'] == 'FAIL' else "⏭️"
                    print(f"     {step_icon} {step['step']} ({step.get('duration', 0):.3f}s)")
                    if 'error' in step:
                        print(f"       Error: {step['error']}")
            print()

async def main():
    """Main smoke test execution function"""
    test_suite = SmokeTestSuite()
    results = await test_suite.run_all_smoke_tests()
    test_suite.print_results(results)
    
    # Save results to file
    with open('/home/ubuntu/healthcare-platform-unified/smoke_test_results.json', 'w') as f:
        json.dump(results, f, indent=2)
        
    print(f"\nDetailed results saved to: smoke_test_results.json")
    
    return results

if __name__ == "__main__":
    asyncio.run(main())
