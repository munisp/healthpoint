#!/usr/bin/env python3
"""
Comprehensive Integration Testing Suite for Unified Healthcare Claims Platform
Tests integration between main platform and NSA/IDR components
"""

import asyncio
import aiohttp
import json
import time
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
import pytest
from dataclasses import dataclass

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class TestResult:
    """Test result data structure"""
    test_name: str
    category: str
    status: str  # 'PASS', 'FAIL', 'SKIP'
    duration: float
    message: str
    details: Optional[Dict] = None

class IntegrationTestSuite:
    """Comprehensive integration testing for unified platform"""
    
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
            # NSA/IDR Services
            'cms_api_integration': 'http://localhost:8012',
            'qpa_calculation': 'http://localhost:8013',
            'gfe_service': 'http://localhost:8014',
            'federal_reporting': 'http://localhost:8015',
            'admin_fee_payment': 'http://localhost:8016',
            'nsa_compliance': 'http://localhost:8017'
        }
        self.results = []
        self.session = None
        
    async def setup_session(self):
        """Setup HTTP session for testing"""
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=30),
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
            
    async def test_service_health(self, service_name: str, url: str) -> TestResult:
        """Test individual service health endpoint"""
        start_time = time.time()
        
        try:
            response = await self.make_request('GET', f"{url}/health")
            duration = time.time() - start_time
            
            if response['status'] == 200:
                return TestResult(
                    test_name=f"Health Check - {service_name}",
                    category="Service Health",
                    status="PASS",
                    duration=duration,
                    message=f"{service_name} service is healthy",
                    details=response['data']
                )
            else:
                return TestResult(
                    test_name=f"Health Check - {service_name}",
                    category="Service Health",
                    status="FAIL",
                    duration=duration,
                    message=f"{service_name} health check failed: {response.get('error', 'Unknown error')}",
                    details=response
                )
        except Exception as e:
            duration = time.time() - start_time
            return TestResult(
                test_name=f"Health Check - {service_name}",
                category="Service Health",
                status="FAIL",
                duration=duration,
                message=f"{service_name} health check exception: {str(e)}"
            )
            
    async def test_service_integration(self) -> List[TestResult]:
        """Test integration between main platform and NSA/IDR services"""
        results = []
        
        # Test 1: User Authentication with NSA/IDR Access
        start_time = time.time()
        try:
            # Authenticate user
            auth_response = await self.make_request(
                'POST', 
                f"{self.base_urls['authentication']}/auth/login",
                json={
                    "email": "admin@medcorp.com",
                    "password": "SecurePass123!"
                }
            )
            
            if auth_response['status'] == 200:
                token = auth_response['data'].get('access_token')
                
                # Test NSA/IDR service access with token
                headers = {'Authorization': f'Bearer {token}'}
                nsa_response = await self.make_request(
                    'GET',
                    f"{self.base_urls['nsa_compliance']}/compliance/status",
                    headers=headers
                )
                
                if nsa_response['status'] == 200:
                    results.append(TestResult(
                        test_name="Authentication Integration with NSA Services",
                        category="Service Integration",
                        status="PASS",
                        duration=time.time() - start_time,
                        message="User can authenticate and access NSA/IDR services",
                        details={'auth_status': auth_response['status'], 'nsa_status': nsa_response['status']}
                    ))
                else:
                    results.append(TestResult(
                        test_name="Authentication Integration with NSA Services",
                        category="Service Integration",
                        status="FAIL",
                        duration=time.time() - start_time,
                        message="Authentication successful but NSA service access failed"
                    ))
            else:
                results.append(TestResult(
                    test_name="Authentication Integration with NSA Services",
                    category="Service Integration",
                    status="FAIL",
                    duration=time.time() - start_time,
                    message="User authentication failed"
                ))
        except Exception as e:
            results.append(TestResult(
                test_name="Authentication Integration with NSA Services",
                category="Service Integration",
                status="FAIL",
                duration=time.time() - start_time,
                message=f"Integration test exception: {str(e)}"
            ))
            
        # Test 2: Claims Processing with NSA/IDR Workflow
        start_time = time.time()
        try:
            # Submit claim for NSA processing
            claim_data = {
                "provider_id": "PROV-001",
                "payer_id": "PAYER-001",
                "patient_id": "PAT-001",
                "service_codes": ["99213", "99214"],
                "service_date": "2025-10-06",
                "billed_amount": 2500.00,
                "nsa_protected": True,
                "emergency_service": False
            }
            
            claims_response = await self.make_request(
                'POST',
                f"{self.base_urls['claims_processing']}/claims/submit",
                json=claim_data
            )
            
            if claims_response['status'] == 201:
                claim_id = claims_response['data'].get('claim_id')
                
                # Test QPA calculation integration
                qpa_response = await self.make_request(
                    'POST',
                    f"{self.base_urls['qpa_calculation']}/qpa/calculate",
                    json={
                        "claim_id": claim_id,
                        "service_codes": claim_data['service_codes'],
                        "geographic_area": "NY-NYC",
                        "service_date": claim_data['service_date']
                    }
                )
                
                if qpa_response['status'] == 200:
                    results.append(TestResult(
                        test_name="Claims Processing with QPA Integration",
                        category="Workflow Integration",
                        status="PASS",
                        duration=time.time() - start_time,
                        message="Claims processing successfully integrated with QPA calculation",
                        details={'claim_id': claim_id, 'qpa_amount': qpa_response['data'].get('qpa_amount')}
                    ))
                else:
                    results.append(TestResult(
                        test_name="Claims Processing with QPA Integration",
                        category="Workflow Integration",
                        status="FAIL",
                        duration=time.time() - start_time,
                        message="Claims submitted but QPA calculation failed"
                    ))
            else:
                results.append(TestResult(
                    test_name="Claims Processing with QPA Integration",
                    category="Workflow Integration",
                    status="FAIL",
                    duration=time.time() - start_time,
                    message="Claims submission failed"
                ))
        except Exception as e:
            results.append(TestResult(
                test_name="Claims Processing with QPA Integration",
                category="Workflow Integration",
                status="FAIL",
                duration=time.time() - start_time,
                message=f"Workflow integration test exception: {str(e)}"
            ))
            
        # Test 3: IDR Dispute Creation and Processing
        start_time = time.time()
        try:
            # Create IDR dispute
            dispute_data = {
                "claim_id": "CLM-789456",
                "provider_npi": "1234567890",
                "payer_id": "BCBS-NY",
                "disputed_amount": 2500.00,
                "qpa_amount": 1800.00,
                "initiating_party": "provider",
                "dispute_reason": "payment_amount",
                "service_date": "2025-09-15"
            }
            
            dispute_response = await self.make_request(
                'POST',
                f"{self.base_urls['cms_api_integration']}/idr/disputes/submit",
                json=dispute_data
            )
            
            if dispute_response['status'] == 201:
                dispute_id = dispute_response['data'].get('dispute_id')
                
                # Test administrative fee payment integration
                payment_response = await self.make_request(
                    'POST',
                    f"{self.base_urls['admin_fee_payment']}/payments/process",
                    json={
                        "dispute_id": dispute_id,
                        "payment_method": "credit_card",
                        "amount": 115.00,
                        "card_token": "tok_test_card"
                    }
                )
                
                if payment_response['status'] == 200:
                    results.append(TestResult(
                        test_name="IDR Dispute Creation with Payment Processing",
                        category="End-to-End Workflow",
                        status="PASS",
                        duration=time.time() - start_time,
                        message="IDR dispute created and administrative fee processed successfully",
                        details={'dispute_id': dispute_id, 'payment_id': payment_response['data'].get('payment_id')}
                    ))
                else:
                    results.append(TestResult(
                        test_name="IDR Dispute Creation with Payment Processing",
                        category="End-to-End Workflow",
                        status="FAIL",
                        duration=time.time() - start_time,
                        message="IDR dispute created but payment processing failed"
                    ))
            else:
                results.append(TestResult(
                    test_name="IDR Dispute Creation with Payment Processing",
                    category="End-to-End Workflow",
                    status="FAIL",
                    duration=time.time() - start_time,
                    message="IDR dispute creation failed"
                ))
        except Exception as e:
            results.append(TestResult(
                test_name="IDR Dispute Creation with Payment Processing",
                category="End-to-End Workflow",
                status="FAIL",
                duration=time.time() - start_time,
                message=f"IDR workflow test exception: {str(e)}"
            ))
            
        # Test 4: Good Faith Estimate Generation and Delivery
        start_time = time.time()
        try:
            gfe_data = {
                "patient_id": "PAT-UNINSURED-001",
                "provider_npi": "1234567890",
                "service_items": [
                    {
                        "service_code": "99213",
                        "description": "Office visit",
                        "estimated_cost": 250.00
                    },
                    {
                        "service_code": "80053",
                        "description": "Lab work",
                        "estimated_cost": 150.00
                    }
                ],
                "delivery_method": "email",
                "patient_email": "patient@example.com"
            }
            
            gfe_response = await self.make_request(
                'POST',
                f"{self.base_urls['gfe_service']}/gfe/generate",
                json=gfe_data
            )
            
            if gfe_response['status'] == 201:
                gfe_id = gfe_response['data'].get('gfe_id')
                
                # Test GFE delivery
                delivery_response = await self.make_request(
                    'POST',
                    f"{self.base_urls['gfe_service']}/gfe/{gfe_id}/deliver"
                )
                
                if delivery_response['status'] == 200:
                    results.append(TestResult(
                        test_name="GFE Generation and Delivery",
                        category="NSA Compliance Workflow",
                        status="PASS",
                        duration=time.time() - start_time,
                        message="GFE generated and delivered successfully",
                        details={'gfe_id': gfe_id, 'delivery_status': delivery_response['data'].get('status')}
                    ))
                else:
                    results.append(TestResult(
                        test_name="GFE Generation and Delivery",
                        category="NSA Compliance Workflow",
                        status="FAIL",
                        duration=time.time() - start_time,
                        message="GFE generated but delivery failed"
                    ))
            else:
                results.append(TestResult(
                    test_name="GFE Generation and Delivery",
                    category="NSA Compliance Workflow",
                    status="FAIL",
                    duration=time.time() - start_time,
                    message="GFE generation failed"
                ))
        except Exception as e:
            results.append(TestResult(
                test_name="GFE Generation and Delivery",
                category="NSA Compliance Workflow",
                status="FAIL",
                duration=time.time() - start_time,
                message=f"GFE workflow test exception: {str(e)}"
            ))
            
        # Test 5: Federal Reporting Integration
        start_time = time.time()
        try:
            # Generate federal report
            report_response = await self.make_request(
                'POST',
                f"{self.base_urls['federal_reporting']}/reports/generate",
                json={
                    "report_type": "idr_quarterly",
                    "period_start": "2025-07-01",
                    "period_end": "2025-09-30",
                    "format": "xml"
                }
            )
            
            if report_response['status'] == 200:
                report_id = report_response['data'].get('report_id')
                
                # Test report validation
                validation_response = await self.make_request(
                    'GET',
                    f"{self.base_urls['federal_reporting']}/reports/{report_id}/validate"
                )
                
                if validation_response['status'] == 200:
                    results.append(TestResult(
                        test_name="Federal Reporting Generation and Validation",
                        category="Compliance Integration",
                        status="PASS",
                        duration=time.time() - start_time,
                        message="Federal report generated and validated successfully",
                        details={'report_id': report_id, 'validation_status': validation_response['data'].get('status')}
                    ))
                else:
                    results.append(TestResult(
                        test_name="Federal Reporting Generation and Validation",
                        category="Compliance Integration",
                        status="FAIL",
                        duration=time.time() - start_time,
                        message="Federal report generated but validation failed"
                    ))
            else:
                results.append(TestResult(
                    test_name="Federal Reporting Generation and Validation",
                    category="Compliance Integration",
                    status="FAIL",
                    duration=time.time() - start_time,
                    message="Federal report generation failed"
                ))
        except Exception as e:
            results.append(TestResult(
                test_name="Federal Reporting Generation and Validation",
                category="Compliance Integration",
                status="FAIL",
                duration=time.time() - start_time,
                message=f"Federal reporting test exception: {str(e)}"
            ))
            
        return results
        
    async def test_data_flow_integration(self) -> List[TestResult]:
        """Test data flow between integrated services"""
        results = []
        
        # Test 1: Provider onboarding with NSA compliance check
        start_time = time.time()
        try:
            provider_data = {
                "npi": "9876543210",
                "name": "Test Healthcare Provider",
                "address": "123 Medical St, Healthcare City, HC 12345",
                "phone": "555-123-4567",
                "email": "provider@testhealthcare.com",
                "specialties": ["Internal Medicine"],
                "network_status": "in_network"
            }
            
            # Submit provider for onboarding
            provider_response = await self.make_request(
                'POST',
                f"{self.base_urls['provider_management']}/providers/onboard",
                json=provider_data
            )
            
            if provider_response['status'] == 201:
                provider_id = provider_response['data'].get('provider_id')
                
                # Check NSA compliance status
                compliance_response = await self.make_request(
                    'GET',
                    f"{self.base_urls['nsa_compliance']}/providers/{provider_id}/compliance"
                )
                
                if compliance_response['status'] == 200:
                    results.append(TestResult(
                        test_name="Provider Onboarding with NSA Compliance Check",
                        category="Data Flow Integration",
                        status="PASS",
                        duration=time.time() - start_time,
                        message="Provider onboarded and NSA compliance verified",
                        details={'provider_id': provider_id, 'compliance_score': compliance_response['data'].get('score')}
                    ))
                else:
                    results.append(TestResult(
                        test_name="Provider Onboarding with NSA Compliance Check",
                        category="Data Flow Integration",
                        status="FAIL",
                        duration=time.time() - start_time,
                        message="Provider onboarded but compliance check failed"
                    ))
            else:
                results.append(TestResult(
                    test_name="Provider Onboarding with NSA Compliance Check",
                    category="Data Flow Integration",
                    status="FAIL",
                    duration=time.time() - start_time,
                    message="Provider onboarding failed"
                ))
        except Exception as e:
            results.append(TestResult(
                test_name="Provider Onboarding with NSA Compliance Check",
                category="Data Flow Integration",
                status="FAIL",
                duration=time.time() - start_time,
                message=f"Data flow test exception: {str(e)}"
            ))
            
        return results
        
    async def run_all_tests(self) -> Dict[str, Any]:
        """Run all integration tests"""
        await self.setup_session()
        
        try:
            logger.info("Starting comprehensive integration testing...")
            
            # Test 1: Service Health Checks
            logger.info("Testing service health endpoints...")
            for service_name, url in self.base_urls.items():
                result = await self.test_service_health(service_name, url)
                self.results.append(result)
                
            # Test 2: Service Integration
            logger.info("Testing service integration...")
            integration_results = await self.test_service_integration()
            self.results.extend(integration_results)
            
            # Test 3: Data Flow Integration
            logger.info("Testing data flow integration...")
            data_flow_results = await self.test_data_flow_integration()
            self.results.extend(data_flow_results)
            
            # Generate summary
            total_tests = len(self.results)
            passed_tests = len([r for r in self.results if r.status == 'PASS'])
            failed_tests = len([r for r in self.results if r.status == 'FAIL'])
            skipped_tests = len([r for r in self.results if r.status == 'SKIP'])
            
            success_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0
            total_duration = sum(r.duration for r in self.results)
            
            summary = {
                'timestamp': datetime.now().isoformat(),
                'total_tests': total_tests,
                'passed': passed_tests,
                'failed': failed_tests,
                'skipped': skipped_tests,
                'success_rate': round(success_rate, 2),
                'total_duration': round(total_duration, 3),
                'categories': {}
            }
            
            # Group results by category
            for result in self.results:
                if result.category not in summary['categories']:
                    summary['categories'][result.category] = {
                        'total': 0,
                        'passed': 0,
                        'failed': 0,
                        'skipped': 0
                    }
                summary['categories'][result.category]['total'] += 1
                if result.status == 'PASS':
                    summary['categories'][result.category]['passed'] += 1
                elif result.status == 'FAIL':
                    summary['categories'][result.category]['failed'] += 1
                elif result.status == 'SKIP':
                    summary['categories'][result.category]['skipped'] += 1
                
            return {
                'summary': summary,
                'results': [
                    {
                        'test_name': r.test_name,
                        'category': r.category,
                        'status': r.status,
                        'duration': r.duration,
                        'message': r.message,
                        'details': r.details
                    }
                    for r in self.results
                ]
            }
            
        finally:
            await self.cleanup_session()
            
    def print_results(self, test_results: Dict[str, Any]):
        """Print formatted test results"""
        summary = test_results['summary']
        
        print("\n" + "="*80)
        print("UNIFIED HEALTHCARE PLATFORM - INTEGRATION TEST RESULTS")
        print("="*80)
        print(f"Timestamp: {summary['timestamp']}")
        print(f"Total Tests: {summary['total_tests']}")
        print(f"Passed: {summary['passed']} ✅")
        print(f"Failed: {summary['failed']} ❌")
        print(f"Skipped: {summary['skipped']} ⏭️")
        print(f"Success Rate: {summary['success_rate']}%")
        print(f"Total Duration: {summary['total_duration']}s")
        
        print("\n" + "-"*80)
        print("RESULTS BY CATEGORY")
        print("-"*80)
        
        for category, stats in summary['categories'].items():
            success_rate = (stats['passed'] / stats['total'] * 100) if stats['total'] > 0 else 0
            print(f"{category}: {stats['passed']}/{stats['total']} ({success_rate:.1f}%)")
            
        print("\n" + "-"*80)
        print("DETAILED RESULTS")
        print("-"*80)
        
        for result in test_results['results']:
            status_icon = "✅" if result['status'] == 'PASS' else "❌" if result['status'] == 'FAIL' else "⏭️"
            print(f"{status_icon} {result['test_name']} ({result['duration']:.3f}s)")
            print(f"   Category: {result['category']}")
            print(f"   Message: {result['message']}")
            if result['details']:
                print(f"   Details: {result['details']}")
            print()

async def main():
    """Main test execution function"""
    test_suite = IntegrationTestSuite()
    results = await test_suite.run_all_tests()
    test_suite.print_results(results)
    
    # Save results to file
    with open('/home/ubuntu/healthcare-platform-unified/integration_test_results.json', 'w') as f:
        json.dump(results, f, indent=2)
        
    print(f"\nDetailed results saved to: integration_test_results.json")
    
    return results

if __name__ == "__main__":
    asyncio.run(main())
