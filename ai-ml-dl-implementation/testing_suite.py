#!/usr/bin/env python3
"""
Healthcare Claims Platform - AI Fraud Detection Service Testing Suite

This script tests the functionality of the AI fraud detection service, including the
detection and feedback endpoints.

Author: Manus AI
Date: October 7, 2025
"""

import requests
import json
import uuid
from datetime import datetime, timedelta

# Configuration
SERVICE_URL = "http://127.0.0.1:8000"

def generate_sample_claim():
    """Generate a sample claim for testing."""
    return {
        "id": str(uuid.uuid4()),
        "claim_number": f"CLAIM-{uuid.uuid4().hex[:6].upper()}",
        "provider_id": "PRV_123456",
        "patient_id": "PAT_789012",
        "tenant_id": "TENANT_A",
        "total_amount": 1250.75,
        "diagnosis_codes": ["I10", "E11.9"],
        "procedure_codes": ["99213", "80053"],
        "service_date_from": (datetime.utcnow() - timedelta(days=10)).isoformat(),
        "service_date_to": (datetime.utcnow() - timedelta(days=9)).isoformat(),
        "submitted_at": datetime.utcnow().isoformat(),
    }

def test_fraud_detection():
    """Test the /detect-fraud endpoint."""
    print("--- Testing /detect-fraud endpoint ---")
    claim_data = generate_sample_claim()
    try:
        response = requests.post(f"{SERVICE_URL}/detect-fraud", json=claim_data)
        response.raise_for_status()
        print("Response from /detect-fraud:")
        print(json.dumps(response.json(), indent=2))
        return response.json()["claim_id"]
    except requests.exceptions.RequestException as e:
        print(f"Error calling /detect-fraud: {e}")
        return None

def test_feedback_endpoint(claim_id):
    """Test the /feedback endpoint."""
    print("\n--- Testing /feedback endpoint ---")
    feedback_data = {
        "claim_id": claim_id,
        "is_correct": False,
        "corrected_risk_level": "high",
        "feedback_notes": "This claim was manually reviewed and confirmed as fraudulent.",
    }
    try:
        response = requests.post(f"{SERVICE_URL}/feedback", json=feedback_data)
        response.raise_for_status()
        print("Response from /feedback:")
        print(json.dumps(response.json(), indent=2))
    except requests.exceptions.RequestException as e:
        print(f"Error calling /feedback: {e}")

if __name__ == "__main__":
    claim_id = test_fraud_detection()
    if claim_id:
        test_feedback_endpoint(claim_id)

