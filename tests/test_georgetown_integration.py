"""
Georgetown-Enhanced IDR Platform Integration Test Suite
Comprehensive testing of all enhanced services and integration

Author: Manus AI
Date: October 9, 2025
"""

import pytest
import asyncio
import httpx
import json
from datetime import datetime, timedelta
from typing import Dict, Any
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class GeorgetownPlatformTester:
    def __init__(self):
        self.base_url = "http://localhost:8000"
        self.service_endpoints = {
            "orchestrator": "http://localhost:8000",
            "volume_management": "http://localhost:8080",
            "predictive_analytics": "http://localhost:8081",
            "entity_selection": "http://localhost:8082",
            "third_party_integration": "http://localhost:8083",
            "eligibility_validation": "http://localhost:8084"
        }
        
        # Test case data based on Georgetown research
        self.test_cases = [
            {
                "case_id": "TEST_TX_RADIOLOGY_001",
                "provider_organization": "Radiology Partners",
                "specialty": "radiology",
                "geographic_location": "TX",
                "dispute_amount": 2500.00,
                "qpa_percentage": 1222.0,  # Georgetown finding for neurology
                "service_date": datetime.utcnow() - timedelta(days=5),
                "submission_deadline": datetime.utcnow() + timedelta(days=25),
                "plan_organization": "Aetna",
                "network_status": "out_of_network",
                "is_emergency": False,
                "has_gfe": True,
                "case_complexity": 2.5,
                "priority_level": "high"
            },
            {
                "case_id": "TEST_FL_EMERGENCY_002",
                "provider_organization": "Team Health",
                "specialty": "emergency",
                "geographic_location": "FL",
                "dispute_amount": 1800.00,
                "qpa_percentage": 450.0,
                "service_date": datetime.utcnow() - timedelta(days=2),
                "submission_deadline": datetime.utcnow() + timedelta(days=28),
                "plan_organization": "UnitedHealth",
                "network_status": "out_of_network",
                "is_emergency": True,
                "has_gfe": False,
                "case_complexity": 1.8,
                "priority_level": "critical"
            },
            {
                "case_id": "TEST_CA_SURGERY_003",
                "provider_organization": "SCP Health",
                "specialty": "surgery",
                "geographic_location": "CA",
                "dispute_amount": 15000.00,
                "qpa_percentage": 1818.0,  # Georgetown finding for surgery
                "service_date": datetime.utcnow() - timedelta(days=10),
                "submission_deadline": datetime.utcnow() + timedelta(days=20),
                "plan_organization": "Anthem",
                "network_status": "out_of_network",
                "is_emergency": False,
                "has_gfe": True,
                "case_complexity": 4.2,
                "priority_level": "medium"
            }
        ]
    
    async def run_comprehensive_tests(self) -> Dict[str, Any]:
        """Run comprehensive test suite"""
        test_results = {
            "test_summary": {
                "total_tests": 0,
                "passed_tests": 0,
                "failed_tests": 0,
                "test_duration_ms": 0
            },
            "service_health_tests": {},
            "integration_tests": {},
            "performance_tests": {},
            "georgetown_validation_tests": {},
            "error_handling_tests": {}
        }
        
        start_time = datetime.utcnow()
        
        try:
            logger.info("Starting Georgetown platform comprehensive tests")
            
            # Test 1: Service Health Checks
            health_results = await self._test_service_health()
            test_results["service_health_tests"] = health_results
            
            # Test 2: Integration Tests
            integration_results = await self._test_case_integration()
            test_results["integration_tests"] = integration_results
            
            # Test 3: Performance Tests
            performance_results = await self._test_performance()
            test_results["performance_tests"] = performance_results
            
            # Test 4: Georgetown Validation Tests
            georgetown_results = await self._test_georgetown_features()
            test_results["georgetown_validation_tests"] = georgetown_results
            
            # Test 5: Error Handling Tests
            error_results = await self._test_error_handling()
            test_results["error_handling_tests"] = error_results
            
            # Calculate test summary
            total_duration = int((datetime.utcnow() - start_time).total_seconds() * 1000)
            test_results["test_summary"]["test_duration_ms"] = total_duration
            
            # Count passed/failed tests
            all_test_sections = [
                health_results, integration_results, performance_results,
                georgetown_results, error_results
            ]
            
            for section in all_test_sections:
                for test_name, test_result in section.items():
                    test_results["test_summary"]["total_tests"] += 1
                    if test_result.get("status") == "passed":
                        test_results["test_summary"]["passed_tests"] += 1
                    else:
                        test_results["test_summary"]["failed_tests"] += 1
            
            logger.info(f"Georgetown platform tests completed in {total_duration}ms")
            return test_results
            
        except Exception as e:
            logger.error(f"Test suite failed: {e}")
            test_results["test_summary"]["error"] = str(e)
            return test_results
    
    async def _test_service_health(self) -> Dict[str, Any]:
        """Test health of all services"""
        health_results = {}
        
        for service_name, endpoint in self.service_endpoints.items():
            try:
                start_time = datetime.utcnow()
                
                async with httpx.AsyncClient() as client:
                    response = await client.get(f"{endpoint}/health", timeout=10.0)
                    response_time = int((datetime.utcnow() - start_time).total_seconds() * 1000)
                    
                    if response.status_code == 200:
                        health_data = response.json()
                        health_results[f"{service_name}_health"] = {
                            "status": "passed",
                            "response_time_ms": response_time,
                            "service_status": health_data.get("status", "unknown"),
                            "details": health_data
                        }
                    else:
                        health_results[f"{service_name}_health"] = {
                            "status": "failed",
                            "response_time_ms": response_time,
                            "error": f"HTTP {response.status_code}",
                            "details": {}
                        }
                        
            except Exception as e:
                health_results[f"{service_name}_health"] = {
                    "status": "failed",
                    "error": str(e),
                    "details": {}
                }
        
        return health_results
    
    async def _test_case_integration(self) -> Dict[str, Any]:
        """Test end-to-end case processing integration"""
        integration_results = {}
        
        for test_case in self.test_cases:
            case_id = test_case["case_id"]
            
            try:
                start_time = datetime.utcnow()
                
                # Convert datetime objects to ISO strings for JSON serialization
                test_case_json = test_case.copy()
                test_case_json["service_date"] = test_case["service_date"].isoformat()
                test_case_json["submission_deadline"] = test_case["submission_deadline"].isoformat()
                
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        f"{self.base_url}/process-case",
                        json=test_case_json,
                        timeout=60.0
                    )
                    
                    processing_time = int((datetime.utcnow() - start_time).total_seconds() * 1000)
                    
                    if response.status_code == 200:
                        result_data = response.json()
                        
                        # Validate response structure
                        required_fields = [
                            "case_id", "overall_status", "processing_stages",
                            "volume_management", "eligibility_validation",
                            "predictive_analytics", "entity_selection",
                            "third_party_integration", "georgetown_insights"
                        ]
                        
                        missing_fields = [field for field in required_fields if field not in result_data]
                        
                        if not missing_fields:
                            integration_results[f"integration_{case_id}"] = {
                                "status": "passed",
                                "processing_time_ms": processing_time,
                                "overall_status": result_data["overall_status"],
                                "stages_completed": len(result_data["processing_stages"]),
                                "georgetown_enhanced": "georgetown_insights" in result_data,
                                "details": result_data
                            }
                        else:
                            integration_results[f"integration_{case_id}"] = {
                                "status": "failed",
                                "error": f"Missing required fields: {missing_fields}",
                                "processing_time_ms": processing_time,
                                "details": result_data
                            }
                    else:
                        integration_results[f"integration_{case_id}"] = {
                            "status": "failed",
                            "error": f"HTTP {response.status_code}",
                            "processing_time_ms": processing_time,
                            "details": {}
                        }
                        
            except Exception as e:
                integration_results[f"integration_{case_id}"] = {
                    "status": "failed",
                    "error": str(e),
                    "details": {}
                }
        
        return integration_results
    
    async def _test_performance(self) -> Dict[str, Any]:
        """Test performance benchmarks"""
        performance_results = {}
        
        # Test concurrent processing
        try:
            start_time = datetime.utcnow()
            
            # Process multiple cases concurrently
            tasks = []
            for i, test_case in enumerate(self.test_cases[:2]):  # Test with 2 concurrent cases
                test_case_json = test_case.copy()
                test_case_json["case_id"] = f"PERF_TEST_{i}"
                test_case_json["service_date"] = test_case["service_date"].isoformat()
                test_case_json["submission_deadline"] = test_case["submission_deadline"].isoformat()
                
                task = self._process_case_async(test_case_json)
                tasks.append(task)
            
            results = await asyncio.gather(*tasks, return_exceptions=True)
            concurrent_time = int((datetime.utcnow() - start_time).total_seconds() * 1000)
            
            successful_results = [r for r in results if not isinstance(r, Exception)]
            
            performance_results["concurrent_processing"] = {
                "status": "passed" if len(successful_results) == len(tasks) else "failed",
                "concurrent_cases": len(tasks),
                "successful_cases": len(successful_results),
                "total_time_ms": concurrent_time,
                "average_time_per_case": concurrent_time / len(tasks) if tasks else 0,
                "details": {"results_count": len(successful_results)}
            }
            
        except Exception as e:
            performance_results["concurrent_processing"] = {
                "status": "failed",
                "error": str(e),
                "details": {}
            }
        
        # Test response time benchmarks
        try:
            response_times = []
            
            for i in range(3):  # Test 3 sequential cases
                start_time = datetime.utcnow()
                
                test_case = self.test_cases[0].copy()
                test_case["case_id"] = f"RESPONSE_TIME_TEST_{i}"
                test_case["service_date"] = test_case["service_date"].isoformat()
                test_case["submission_deadline"] = test_case["submission_deadline"].isoformat()
                
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        f"{self.base_url}/process-case",
                        json=test_case,
                        timeout=60.0
                    )
                    
                    response_time = int((datetime.utcnow() - start_time).total_seconds() * 1000)
                    response_times.append(response_time)
            
            avg_response_time = sum(response_times) / len(response_times)
            max_response_time = max(response_times)
            min_response_time = min(response_times)
            
            # Georgetown benchmark: < 5 seconds for standard processing
            benchmark_met = avg_response_time < 5000
            
            performance_results["response_time_benchmark"] = {
                "status": "passed" if benchmark_met else "failed",
                "average_response_time_ms": avg_response_time,
                "max_response_time_ms": max_response_time,
                "min_response_time_ms": min_response_time,
                "benchmark_threshold_ms": 5000,
                "benchmark_met": benchmark_met,
                "details": {"response_times": response_times}
            }
            
        except Exception as e:
            performance_results["response_time_benchmark"] = {
                "status": "failed",
                "error": str(e),
                "details": {}
            }
        
        return performance_results
    
    async def _test_georgetown_features(self) -> Dict[str, Any]:
        """Test Georgetown-specific features and insights"""
        georgetown_results = {}
        
        # Test Georgetown metrics endpoint
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{self.base_url}/georgetown-metrics", timeout=10.0)
                
                if response.status_code == 200:
                    metrics_data = response.json()
                    
                    required_metrics = [
                        "total_cases_processed", "average_processing_time",
                        "success_rate"
                    ]
                    
                    has_required_metrics = all(metric in metrics_data for metric in required_metrics)
                    
                    georgetown_results["georgetown_metrics"] = {
                        "status": "passed" if has_required_metrics else "failed",
                        "metrics_available": has_required_metrics,
                        "details": metrics_data
                    }
                else:
                    georgetown_results["georgetown_metrics"] = {
                        "status": "failed",
                        "error": f"HTTP {response.status_code}",
                        "details": {}
                    }
                    
        except Exception as e:
            georgetown_results["georgetown_metrics"] = {
                "status": "failed",
                "error": str(e),
                "details": {}
            }
        
        # Test Georgetown insights in case processing
        try:
            test_case = self.test_cases[0].copy()
            test_case["case_id"] = "GEORGETOWN_INSIGHTS_TEST"
            test_case["service_date"] = test_case["service_date"].isoformat()
            test_case["submission_deadline"] = test_case["submission_deadline"].isoformat()
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/process-case",
                    json=test_case,
                    timeout=60.0
                )
                
                if response.status_code == 200:
                    result_data = response.json()
                    
                    # Check for Georgetown insights
                    has_georgetown_insights = "georgetown_insights" in result_data
                    insights_data = result_data.get("georgetown_insights", {})
                    
                    # Validate Georgetown-specific fields
                    georgetown_fields = [
                        "overall_georgetown_assessment", "performance_summary"
                    ]
                    
                    has_georgetown_fields = any(field in insights_data for field in georgetown_fields)
                    
                    georgetown_results["georgetown_insights_integration"] = {
                        "status": "passed" if has_georgetown_insights and has_georgetown_fields else "failed",
                        "insights_present": has_georgetown_insights,
                        "georgetown_fields_present": has_georgetown_fields,
                        "details": insights_data
                    }
                else:
                    georgetown_results["georgetown_insights_integration"] = {
                        "status": "failed",
                        "error": f"HTTP {response.status_code}",
                        "details": {}
                    }
                    
        except Exception as e:
            georgetown_results["georgetown_insights_integration"] = {
                "status": "failed",
                "error": str(e),
                "details": {}
            }
        
        return georgetown_results
    
    async def _test_error_handling(self) -> Dict[str, Any]:
        """Test error handling and edge cases"""
        error_results = {}
        
        # Test invalid case data
        try:
            invalid_case = {
                "case_id": "INVALID_TEST",
                "provider_organization": "",  # Invalid empty string
                "specialty": "invalid_specialty",
                "geographic_location": "XX",  # Invalid state
                "dispute_amount": -100.0,  # Invalid negative amount
                "qpa_percentage": -50.0,  # Invalid negative percentage
                "service_date": "invalid_date",
                "submission_deadline": "invalid_date",
                "plan_organization": "",
                "network_status": "invalid_status"
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/process-case",
                    json=invalid_case,
                    timeout=30.0
                )
                
                # Should return 422 (validation error) or 400 (bad request)
                if response.status_code in [400, 422]:
                    error_results["invalid_data_handling"] = {
                        "status": "passed",
                        "correctly_rejected": True,
                        "response_code": response.status_code,
                        "details": {"message": "Invalid data correctly rejected"}
                    }
                else:
                    error_results["invalid_data_handling"] = {
                        "status": "failed",
                        "correctly_rejected": False,
                        "response_code": response.status_code,
                        "details": {"message": "Invalid data not properly rejected"}
                    }
                    
        except Exception as e:
            error_results["invalid_data_handling"] = {
                "status": "failed",
                "error": str(e),
                "details": {}
            }
        
        # Test service timeout handling
        try:
            # This test would require a way to simulate service timeouts
            # For now, we'll test with a very short timeout
            test_case = self.test_cases[0].copy()
            test_case["case_id"] = "TIMEOUT_TEST"
            test_case["service_date"] = test_case["service_date"].isoformat()
            test_case["submission_deadline"] = test_case["submission_deadline"].isoformat()
            
            async with httpx.AsyncClient() as client:
                try:
                    response = await client.post(
                        f"{self.base_url}/process-case",
                        json=test_case,
                        timeout=0.1  # Very short timeout to force timeout
                    )
                    
                    error_results["timeout_handling"] = {
                        "status": "failed",
                        "details": {"message": "Timeout not triggered as expected"}
                    }
                    
                except httpx.TimeoutException:
                    error_results["timeout_handling"] = {
                        "status": "passed",
                        "timeout_handled": True,
                        "details": {"message": "Timeout properly handled"}
                    }
                    
        except Exception as e:
            error_results["timeout_handling"] = {
                "status": "failed",
                "error": str(e),
                "details": {}
            }
        
        return error_results
    
    async def _process_case_async(self, test_case: Dict[str, Any]) -> Dict[str, Any]:
        """Process a case asynchronously for performance testing"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/process-case",
                json=test_case,
                timeout=60.0
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                raise Exception(f"HTTP {response.status_code}")

# Test runner function
async def run_georgetown_tests():
    """Run the Georgetown platform test suite"""
    tester = GeorgetownPlatformTester()
    results = await tester.run_comprehensive_tests()
    return results

if __name__ == "__main__":
    # Run tests
    results = asyncio.run(run_georgetown_tests())
    
    # Print summary
    summary = results["test_summary"]
    print(f"\n=== Georgetown Platform Test Results ===")
    print(f"Total Tests: {summary['total_tests']}")
    print(f"Passed: {summary['passed_tests']}")
    print(f"Failed: {summary['failed_tests']}")
    print(f"Duration: {summary['test_duration_ms']}ms")
    print(f"Success Rate: {(summary['passed_tests'] / summary['total_tests'] * 100):.1f}%")
    
    # Save detailed results
    with open("/home/ubuntu/unified-platform/tests/test_results.json", "w") as f:
        json.dump(results, f, indent=2, default=str)
