#!/bin/bash
# Unified Deployment Script for Healthcare Claims Platform

# Exit on error
set -e

# 1. Install Dependencies
sudo apt-get update
sudo apt-get install -y python3-venv supervisor redis-server

# 2. Setup Python Environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 3. Configure and Start Services with Supervisor
for i in {8001..8017}; do
    SERVICE_NAME=$(grep -l "port=$i" *.py | sed 's/.py//')
    if [ -n "$SERVICE_NAME" ]; then
        echo "Configuring $SERVICE_NAME on port $i"
        sudo bash -c "cat > /etc/supervisor/conf.d/$SERVICE_NAME.conf" << EOL
[program:$SERVICE_NAME]
command=$(pwd)/venv/bin/uvicorn $SERVICE_NAME:app --host 0.0.0.0 --port $i
directory=$(pwd)
autostart=true
autorestart=true
stderr_logfile=/var/log/supervisor/$SERVICE_NAME.err.log
stdout_logfile=/var/log/supervisor/$SERVICE_NAME.out.log
EOL
    fi
done

# 4. Reload Supervisor and Start Services
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl start all

# 5. Health Checks
sleep 10 # Give services time to start
for i in {8001..8017}; do
    echo "Checking service on port $i"
    curl -f http://localhost:$i/health || echo "Service on port $i failed health check"
done


