#!/usr/bin/env python3
"""
Comprehensive Regression Testing Suite for Unified Healthcare Claims Platform
Ensures existing functionality remains intact after NSA/IDR integration
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
class RegressionTestResult:
    """Regression test result data structure"""
    test_name: str
    category: str
    status: str  # 'PASS', 'FAIL', 'SKIP'
    duration: float
    message: str
    baseline_result: Optional[Dict] = None
    current_result: Optional[Dict] = None
    regression_detected: bool = False

class RegressionTestSuite:
    """Comprehensive regression testing for unified platform"""
    
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
            'kyb_verification': 'http://localhost:8011'
        }
        self.results = []
        self.session = None
        
        # Baseline performance expectations
        self.performance_baselines = {
            'health_check_max_time': 1.0,  # seconds
            'authentication_max_time': 2.0,
            'claims_processing_max_time': 5.0,
            'search_max_time': 3.0,
            'notification_max_time': 2.0
        }
        
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
            
    async def test_core_authentication_functionality(self) -> List[RegressionTestResult]:
        """Test core authentication functionality remains intact"""
        results = []
        
        # Test 1: User Login Functionality
        start_time = time.time()
        try:
            login_response = await self.make_request(
                'POST',
                f"{self.base_urls['authentication']}/auth/login",
                json={
                    "email": "admin@medcorp.com",
                    "password": "SecurePass123!"
                }
            )
            
            duration = time.time() - start_time
            
            if login_response['status'] == 200 and 'access_token' in login_response['data']:
                regression_detected = duration > self.performance_baselines['authentication_max_time']
                results.append(RegressionTestResult(
                    test_name="User Login Functionality",
                    category="Core Authentication",
                    status="PASS",
                    duration=duration,
                    message="User login working correctly",
                    current_result={'status': login_response['status'], 'duration': duration},
                    regression_detected=regression_detected
                ))
            else:
                results.append(RegressionTestResult(
                    test_name="User Login Functionality",
                    category="Core Authentication",
                    status="FAIL",
                    duration=duration,
                    message="User login failed - regression detected",
                    current_result=login_response,
                    regression_detected=True
                ))
        except Exception as e:
            results.append(RegressionTestResult(
                test_name="User Login Functionality",
                category="Core Authentication",
                status="FAIL",
                duration=time.time() - start_time,
                message=f"Authentication test exception: {str(e)}",
                regression_detected=True
            ))
            
        # Test 2: Token Validation
        start_time = time.time()
        try:
            # First get a token
            login_response = await self.make_request(
                'POST',
                f"{self.base_urls['authentication']}/auth/login",
                json={"email": "admin@medcorp.com", "password": "SecurePass123!"}
            )
            
            if login_response['status'] == 200:
                token = login_response['data']['access_token']
                
                # Test token validation
                validate_response = await self.make_request(
                    'GET',
                    f"{self.base_urls['authentication']}/auth/validate",
                    headers={'Authorization': f'Bearer {token}'}
                )
                
                duration = time.time() - start_time
                
                if validate_response['status'] == 200:
                    results.append(RegressionTestResult(
                        test_name="Token Validation",
                        category="Core Authentication",
                        status="PASS",
                        duration=duration,
                        message="Token validation working correctly",
                        current_result={'status': validate_response['status'], 'duration': duration}
                    ))
                else:
                    results.append(RegressionTestResult(
                        test_name="Token Validation",
                        category="Core Authentication",
                        status="FAIL",
                        duration=duration,
                        message="Token validation failed - regression detected",
                        regression_detected=True
                    ))
            else:
                results.append(RegressionTestResult(
                    test_name="Token Validation",
                    category="Core Authentication",
                    status="FAIL",
                    duration=time.time() - start_time,
                    message="Cannot obtain token for validation test",
                    regression_detected=True
                ))
        except Exception as e:
            results.append(RegressionTestResult(
                test_name="Token Validation",
                category="Core Authentication",
                status="FAIL",
                duration=time.time() - start_time,
                message=f"Token validation test exception: {str(e)}",
                regression_detected=True
            ))
            
        return results
        
    async def test_core_user_management_functionality(self) -> List[RegressionTestResult]:
        """Test core user management functionality remains intact"""
        results = []
        
        # Test 1: User Creation
        start_time = time.time()
        try:
            user_data = {
                "email": f"test.user.{int(time.time())}@example.com",
                "password": "TestPass123!",
                "firstName": "Test",
                "lastName": "User",
                "role": "provider_user",
                "tenantId": "tenant-001"
            }
            
            create_response = await self.make_request(
                'POST',
                f"{self.base_urls['user_management']}/users",
                json=user_data
            )
            
            duration = time.time() - start_time
            
            if create_response['status'] == 201:
                results.append(RegressionTestResult(
                    test_name="User Creation",
                    category="Core User Management",
                    status="PASS",
                    duration=duration,
                    message="User creation working correctly",
                    current_result={'status': create_response['status'], 'user_id': create_response['data'].get('id')}
                ))
            else:
                results.append(RegressionTestResult(
                    test_name="User Creation",
                    category="Core User Management",
                    status="FAIL",
                    duration=duration,
                    message="User creation failed - regression detected",
                    current_result=create_response,
                    regression_detected=True
                ))
        except Exception as e:
            results.append(RegressionTestResult(
                test_name="User Creation",
                category="Core User Management",
                status="FAIL",
                duration=time.time() - start_time,
                message=f"User creation test exception: {str(e)}",
                regression_detected=True
            ))
            
        # Test 2: User Listing
        start_time = time.time()
        try:
            list_response = await self.make_request(
                'GET',
                f"{self.base_urls['user_management']}/users?limit=10"
            )
            
            duration = time.time() - start_time
            
            if list_response['status'] == 200 and 'users' in list_response['data']:
                results.append(RegressionTestResult(
                    test_name="User Listing",
                    category="Core User Management",
                    status="PASS",
                    duration=duration,
                    message="User listing working correctly",
                    current_result={'status': list_response['status'], 'user_count': len(list_response['data']['users'])}
                ))
            else:
                results.append(RegressionTestResult(
                    test_name="User Listing",
                    category="Core User Management",
                    status="FAIL",
                    duration=duration,
                    message="User listing failed - regression detected",
                    regression_detected=True
                ))
        except Exception as e:
            results.append(RegressionTestResult(
                test_name="User Listing",
                category="Core User Management",
                status="FAIL",
                duration=time.time() - start_time,
                message=f"User listing test exception: {str(e)}",
                regression_detected=True
            ))
            
        return results
        
    async def test_core_claims_processing_functionality(self) -> List[RegressionTestResult]:
        """Test core claims processing functionality remains intact"""
        results = []
        
        # Test 1: Claims Submission
        start_time = time.time()
        try:
            claim_data = {
                "provider_id": "PROV-001",
                "payer_id": "PAYER-001",
                "patient_id": "PAT-001",
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
            
            duration = time.time() - start_time
            regression_detected = duration > self.performance_baselines['claims_processing_max_time']
            
            if submit_response['status'] == 201:
                results.append(RegressionTestResult(
                    test_name="Claims Submission",
                    category="Core Claims Processing",
                    status="PASS",
                    duration=duration,
                    message="Claims submission working correctly",
                    current_result={'status': submit_response['status'], 'claim_id': submit_response['data'].get('claim_id')},
                    regression_detected=regression_detected
                ))
            else:
                results.append(RegressionTestResult(
                    test_name="Claims Submission",
                    category="Core Claims Processing",
                    status="FAIL",
                    duration=duration,
                    message="Claims submission failed - regression detected",
                    regression_detected=True
                ))
        except Exception as e:
            results.append(RegressionTestResult(
                test_name="Claims Submission",
                category="Core Claims Processing",
                status="FAIL",
                duration=time.time() - start_time,
                message=f"Claims submission test exception: {str(e)}",
                regression_detected=True
            ))
            
        # Test 2: Claims Status Check
        start_time = time.time()
        try:
            status_response = await self.make_request(
                'GET',
                f"{self.base_urls['claims_processing']}/claims/CLM-TEST-001/status"
            )
            
            duration = time.time() - start_time
            
            if status_response['status'] in [200, 404]:  # 404 is acceptable for non-existent claim
                results.append(RegressionTestResult(
                    test_name="Claims Status Check",
                    category="Core Claims Processing",
                    status="PASS",
                    duration=duration,
                    message="Claims status check working correctly",
                    current_result={'status': status_response['status']}
                ))
            else:
                results.append(RegressionTestResult(
                    test_name="Claims Status Check",
                    category="Core Claims Processing",
                    status="FAIL",
                    duration=duration,
                    message="Claims status check failed - regression detected",
                    regression_detected=True
                ))
        except Exception as e:
            results.append(RegressionTestResult(
                test_name="Claims Status Check",
                category="Core Claims Processing",
                status="FAIL",
                duration=time.time() - start_time,
                message=f"Claims status test exception: {str(e)}",
                regression_detected=True
            ))
            
        return results
        
    async def test_core_provider_management_functionality(self) -> List[RegressionTestResult]:
        """Test core provider management functionality remains intact"""
        results = []
        
        # Test 1: Provider Registration
        start_time = time.time()
        try:
            provider_data = {
                "npi": f"123456{int(time.time()) % 10000}",
                "name": "Test Healthcare Provider",
                "address": "123 Medical St, Healthcare City, HC 12345",
                "phone": "555-123-4567",
                "email": f"provider.{int(time.time())}@example.com",
                "specialties": ["Internal Medicine"]
            }
            
            register_response = await self.make_request(
                'POST',
                f"{self.base_urls['provider_management']}/providers/register",
                json=provider_data
            )
            
            duration = time.time() - start_time
            
            if register_response['status'] == 201:
                results.append(RegressionTestResult(
                    test_name="Provider Registration",
                    category="Core Provider Management",
                    status="PASS",
                    duration=duration,
                    message="Provider registration working correctly",
                    current_result={'status': register_response['status'], 'provider_id': register_response['data'].get('id')}
                ))
            else:
                results.append(RegressionTestResult(
                    test_name="Provider Registration",
                    category="Core Provider Management",
                    status="FAIL",
                    duration=duration,
                    message="Provider registration failed - regression detected",
                    regression_detected=True
                ))
        except Exception as e:
            results.append(RegressionTestResult(
                test_name="Provider Registration",
                category="Core Provider Management",
                status="FAIL",
                duration=time.time() - start_time,
                message=f"Provider registration test exception: {str(e)}",
                regression_detected=True
            ))
            
        # Test 2: Provider Search
        start_time = time.time()
        try:
            search_response = await self.make_request(
                'GET',
                f"{self.base_urls['provider_management']}/providers/search?specialty=Internal Medicine&limit=5"
            )
            
            duration = time.time() - start_time
            
            if search_response['status'] == 200:
                results.append(RegressionTestResult(
                    test_name="Provider Search",
                    category="Core Provider Management",
                    status="PASS",
                    duration=duration,
                    message="Provider search working correctly",
                    current_result={'status': search_response['status'], 'results_count': len(search_response['data'].get('providers', []))}
                ))
            else:
                results.append(RegressionTestResult(
                    test_name="Provider Search",
                    category="Core Provider Management",
                    status="FAIL",
                    duration=duration,
                    message="Provider search failed - regression detected",
                    regression_detected=True
                ))
        except Exception as e:
            results.append(RegressionTestResult(
                test_name="Provider Search",
                category="Core Provider Management",
                status="FAIL",
                duration=time.time() - start_time,
                message=f"Provider search test exception: {str(e)}",
                regression_detected=True
            ))
            
        return results
        
    async def test_core_notification_functionality(self) -> List[RegressionTestResult]:
        """Test core notification functionality remains intact"""
        results = []
        
        # Test 1: Notification Sending
        start_time = time.time()
        try:
            notification_data = {
                "recipient_id": "user-001",
                "type": "email",
                "subject": "Test Notification",
                "message": "This is a test notification for regression testing",
                "priority": "normal"
            }
            
            send_response = await self.make_request(
                'POST',
                f"{self.base_urls['notification']}/notifications/send",
                json=notification_data
            )
            
            duration = time.time() - start_time
            regression_detected = duration > self.performance_baselines['notification_max_time']
            
            if send_response['status'] == 201:
                results.append(RegressionTestResult(
                    test_name="Notification Sending",
                    category="Core Notification",
                    status="PASS",
                    duration=duration,
                    message="Notification sending working correctly",
                    current_result={'status': send_response['status'], 'notification_id': send_response['data'].get('id')},
                    regression_detected=regression_detected
                ))
            else:
                results.append(RegressionTestResult(
                    test_name="Notification Sending",
                    category="Core Notification",
                    status="FAIL",
                    duration=duration,
                    message="Notification sending failed - regression detected",
                    regression_detected=True
                ))
        except Exception as e:
            results.append(RegressionTestResult(
                test_name="Notification Sending",
                category="Core Notification",
                status="FAIL",
                duration=time.time() - start_time,
                message=f"Notification sending test exception: {str(e)}",
                regression_detected=True
            ))
            
        return results
        
    async def test_core_search_analytics_functionality(self) -> List[RegressionTestResult]:
        """Test core search and analytics functionality remains intact"""
        results = []
        
        # Test 1: Search Functionality
        start_time = time.time()
        try:
            search_response = await self.make_request(
                'GET',
                f"{self.base_urls['search_analytics']}/search?q=healthcare&type=claims&limit=10"
            )
            
            duration = time.time() - start_time
            regression_detected = duration > self.performance_baselines['search_max_time']
            
            if search_response['status'] == 200:
                results.append(RegressionTestResult(
                    test_name="Search Functionality",
                    category="Core Search Analytics",
                    status="PASS",
                    duration=duration,
                    message="Search functionality working correctly",
                    current_result={'status': search_response['status'], 'results_count': len(search_response['data'].get('results', []))},
                    regression_detected=regression_detected
                ))
            else:
                results.append(RegressionTestResult(
                    test_name="Search Functionality",
                    category="Core Search Analytics",
                    status="FAIL",
                    duration=duration,
                    message="Search functionality failed - regression detected",
                    regression_detected=True
                ))
        except Exception as e:
            results.append(RegressionTestResult(
                test_name="Search Functionality",
                category="Core Search Analytics",
                status="FAIL",
                duration=time.time() - start_time,
                message=f"Search functionality test exception: {str(e)}",
                regression_detected=True
            ))
            
        # Test 2: Analytics Dashboard
        start_time = time.time()
        try:
            analytics_response = await self.make_request(
                'GET',
                f"{self.base_urls['search_analytics']}/analytics/dashboard"
            )
            
            duration = time.time() - start_time
            
            if analytics_response['status'] == 200:
                results.append(RegressionTestResult(
                    test_name="Analytics Dashboard",
                    category="Core Search Analytics",
                    status="PASS",
                    duration=duration,
                    message="Analytics dashboard working correctly",
                    current_result={'status': analytics_response['status']}
                ))
            else:
                results.append(RegressionTestResult(
                    test_name="Analytics Dashboard",
                    category="Core Search Analytics",
                    status="FAIL",
                    duration=duration,
                    message="Analytics dashboard failed - regression detected",
                    regression_detected=True
                ))
        except Exception as e:
            results.append(RegressionTestResult(
                test_name="Analytics Dashboard",
                category="Core Search Analytics",
                status="FAIL",
                duration=time.time() - start_time,
                message=f"Analytics dashboard test exception: {str(e)}",
                regression_detected=True
            ))
            
        return results
        
    async def test_performance_regression(self) -> List[RegressionTestResult]:
        """Test for performance regressions in core services"""
        results = []
        
        # Test health check performance for all services
        for service_name, url in self.base_urls.items():
            start_time = time.time()
            try:
                health_response = await self.make_request('GET', f"{url}/health")
                duration = time.time() - start_time
                
                regression_detected = duration > self.performance_baselines['health_check_max_time']
                
                if health_response['status'] == 200:
                    status = "FAIL" if regression_detected else "PASS"
                    message = f"Health check performance {'degraded' if regression_detected else 'acceptable'} ({duration:.3f}s)"
                    
                    results.append(RegressionTestResult(
                        test_name=f"Performance - {service_name} Health Check",
                        category="Performance Regression",
                        status=status,
                        duration=duration,
                        message=message,
                        current_result={'duration': duration, 'baseline': self.performance_baselines['health_check_max_time']},
                        regression_detected=regression_detected
                    ))
                else:
                    results.append(RegressionTestResult(
                        test_name=f"Performance - {service_name} Health Check",
                        category="Performance Regression",
                        status="FAIL",
                        duration=duration,
                        message=f"Service unavailable - cannot test performance",
                        regression_detected=True
                    ))
            except Exception as e:
                results.append(RegressionTestResult(
                    test_name=f"Performance - {service_name} Health Check",
                    category="Performance Regression",
                    status="FAIL",
                    duration=time.time() - start_time,
                    message=f"Performance test exception: {str(e)}",
                    regression_detected=True
                ))
                
        return results
        
    async def run_all_regression_tests(self) -> Dict[str, Any]:
        """Run all regression tests"""
        await self.setup_session()
        
        try:
            logger.info("Starting comprehensive regression testing...")
            
            # Test 1: Core Authentication
            logger.info("Testing core authentication functionality...")
            auth_results = await self.test_core_authentication_functionality()
            self.results.extend(auth_results)
            
            # Test 2: Core User Management
            logger.info("Testing core user management functionality...")
            user_mgmt_results = await self.test_core_user_management_functionality()
            self.results.extend(user_mgmt_results)
            
            # Test 3: Core Claims Processing
            logger.info("Testing core claims processing functionality...")
            claims_results = await self.test_core_claims_processing_functionality()
            self.results.extend(claims_results)
            
            # Test 4: Core Provider Management
            logger.info("Testing core provider management functionality...")
            provider_results = await self.test_core_provider_management_functionality()
            self.results.extend(provider_results)
            
            # Test 5: Core Notification
            logger.info("Testing core notification functionality...")
            notification_results = await self.test_core_notification_functionality()
            self.results.extend(notification_results)
            
            # Test 6: Core Search Analytics
            logger.info("Testing core search analytics functionality...")
            search_results = await self.test_core_search_analytics_functionality()
            self.results.extend(search_results)
            
            # Test 7: Performance Regression
            logger.info("Testing performance regression...")
            performance_results = await self.test_performance_regression()
            self.results.extend(performance_results)
            
            # Generate summary
            total_tests = len(self.results)
            passed_tests = len([r for r in self.results if r.status == 'PASS'])
            failed_tests = len([r for r in self.results if r.status == 'FAIL'])
            skipped_tests = len([r for r in self.results if r.status == 'SKIP'])
            regressions_detected = len([r for r in self.results if r.regression_detected])
            
            success_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0
            total_duration = sum(r.duration for r in self.results)
            
            summary = {
                'timestamp': datetime.now().isoformat(),
                'total_tests': total_tests,
                'passed': passed_tests,
                'failed': failed_tests,
                'skipped': skipped_tests,
                'regressions_detected': regressions_detected,
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
                        'skipped': 0,
                        'regressions': 0
                    }
                summary['categories'][result.category]['total'] += 1
                if result.status == 'PASS':
                    summary['categories'][result.category]['passed'] += 1
                elif result.status == 'FAIL':
                    summary['categories'][result.category]['failed'] += 1
                elif result.status == 'SKIP':
                    summary['categories'][result.category]['skipped'] += 1
                    
                if result.regression_detected:
                    summary['categories'][result.category]['regressions'] += 1
                
            return {
                'summary': summary,
                'results': [
                    {
                        'test_name': r.test_name,
                        'category': r.category,
                        'status': r.status,
                        'duration': r.duration,
                        'message': r.message,
                        'regression_detected': r.regression_detected,
                        'baseline_result': r.baseline_result,
                        'current_result': r.current_result
                    }
                    for r in self.results
                ]
            }
            
        finally:
            await self.cleanup_session()
            
    def print_results(self, test_results: Dict[str, Any]):
        """Print formatted regression test results"""
        summary = test_results['summary']
        
        print("\n" + "="*80)
        print("UNIFIED HEALTHCARE PLATFORM - REGRESSION TEST RESULTS")
        print("="*80)
        print(f"Timestamp: {summary['timestamp']}")
        print(f"Total Tests: {summary['total_tests']}")
        print(f"Passed: {summary['passed']} ✅")
        print(f"Failed: {summary['failed']} ❌")
        print(f"Skipped: {summary['skipped']} ⏭️")
        print(f"Regressions Detected: {summary['regressions_detected']} 🔍")
        print(f"Success Rate: {summary['success_rate']}%")
        print(f"Total Duration: {summary['total_duration']}s")
        
        print("\n" + "-"*80)
        print("RESULTS BY CATEGORY")
        print("-"*80)
        
        for category, stats in summary['categories'].items():
            success_rate = (stats['passed'] / stats['total'] * 100) if stats['total'] > 0 else 0
            regression_info = f" ({stats['regressions']} regressions)" if stats['regressions'] > 0 else ""
            print(f"{category}: {stats['passed']}/{stats['total']} ({success_rate:.1f}%){regression_info}")
            
        print("\n" + "-"*80)
        print("DETAILED RESULTS")
        print("-"*80)
        
        for result in test_results['results']:
            status_icon = "✅" if result['status'] == 'PASS' else "❌" if result['status'] == 'FAIL' else "⏭️"
            regression_icon = " 🔍" if result['regression_detected'] else ""
            print(f"{status_icon} {result['test_name']} ({result['duration']:.3f}s){regression_icon}")
            print(f"   Category: {result['category']}")
            print(f"   Message: {result['message']}")
            if result['current_result']:
                print(f"   Current Result: {result['current_result']}")
            print()

async def main():
    """Main regression test execution function"""
    test_suite = RegressionTestSuite()
    results = await test_suite.run_all_regression_tests()
    test_suite.print_results(results)
    
    # Save results to file
    with open('/home/ubuntu/healthcare-platform-unified/regression_test_results.json', 'w') as f:
        json.dump(results, f, indent=2)
        
    print(f"\nDetailed results saved to: regression_test_results.json")
    
    return results

if __name__ == "__main__":
    asyncio.run(main())
