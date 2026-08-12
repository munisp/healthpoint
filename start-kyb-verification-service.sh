#!/bin/bash
cd /home/ubuntu/healthcare-platform-complete
source venv/bin/activate
source .env
export PYTHONPATH=$PYTHONPATH:/home/ubuntu/healthcare-platform-complete
uvicorn kyb_verification_service_simple:app --host 0.0.0.0 --port 8011 --log-level info
