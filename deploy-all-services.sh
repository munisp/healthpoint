#!/bin/bash

# Healthcare Claims Platform - Automated Service Deployment Script
# This script implements the connection errors resolution plan
# Author: Manus AI
# Date: October 6, 2025

set -e  # Exit on any error

echo "=========================================="
echo "Healthcare Claims Platform Deployment"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   error "This script should not be run as root for security reasons"
   exit 1
fi

# Phase 1: Infrastructure Setup
log "Phase 1: Setting up infrastructure..."

# Install system dependencies
log "Installing system dependencies..."
sudo apt update
sudo apt install -y python3-pip python3-venv redis-server supervisor curl

# Start Redis
log "Starting Redis server..."
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Verify Redis is running
if redis-cli ping > /dev/null 2>&1; then
    success "Redis is running"
else
    error "Redis failed to start"
    exit 1
fi

# Phase 2: Python Environment Setup
log "Phase 2: Setting up Python environment..."

# Create virtual environment
if [ ! -d "venv" ]; then
    log "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install Python dependencies
log "Installing Python dependencies..."
pip install --upgrade pip

# Core FastAPI dependencies
pip install fastapi uvicorn[standard] python-multipart

# Database dependencies
pip install asyncpg aioredis sqlalchemy alembic

# Authentication and security
pip install python-jose[cryptography] passlib[bcrypt] python-multipart

# HTTP client and WebSocket support
pip install httpx websockets aiofiles

# Data processing and validation
pip install pydantic pandas numpy

# Additional dependencies for specific services
pip install scikit-learn pillow opencv-python-headless

# Testing dependencies (already installed)
# pip install pytest pytest-asyncio aiohttp

success "Python dependencies installed"

# Phase 3: Environment Configuration
log "Phase 3: Configuring environment..."

# Create environment file
cat > .env << EOF
# Database Configuration
DATABASE_URL=postgresql://ubuntu:password@localhost/healthcare_platform
REDIS_URL=redis://localhost:6379

# Security Configuration
JWT_SECRET_KEY=healthcare-platform-super-secret-jwt-key-2025
ENCRYPTION_KEY=healthcare-platform-32-byte-key-2025

# API Keys (mock values for testing)
BALLERINE_API_KEY=test-ballerine-api-key
BALLERINE_API_URL=https://api.ballerine.com
OPENAI_API_KEY=test-openai-api-key

# Service Configuration
ENVIRONMENT=development
LOG_LEVEL=INFO
EOF

success "Environment configuration created"

# Phase 4: Service Deployment Scripts
log "Phase 4: Creating service deployment scripts..."

# Service port mapping
declare -A services=(
    ["user-management-service"]=8001
    ["provider-management-service"]=8002
    ["authentication-service"]=8003
    ["api-gateway-service"]=8004
    ["claims-processing-service"]=8005
    ["notification-service"]=8006
    ["search-analytics-service"]=8007
    ["enhanced-user-management-service"]=8008
    ["ai-fraud-detection-service"]=8009
    ["document-verification-service"]=8010
    ["kyb-verification-service"]=8011
)

# Create startup scripts for each service
for service in "${!services[@]}"; do
    port=${services[$service]}
    
    log "Creating startup script for $service on port $port..."
    
    cat > "start-${service}.sh" << EOF
#!/bin/bash
cd /home/ubuntu/healthcare-platform-complete
source venv/bin/activate
source .env
export PYTHONPATH=\$PYTHONPATH:/home/ubuntu/healthcare-platform-complete
uvicorn ${service}:app --host 0.0.0.0 --port $port --reload --log-level info
EOF
    
    chmod +x "start-${service}.sh"
done

success "Service startup scripts created"

# Phase 5: Process Management Configuration
log "Phase 5: Configuring process management..."

# Create supervisor configurations
for service in "${!services[@]}"; do
    port=${services[$service]}
    
    log "Creating supervisor config for $service..."
    
    sudo tee "/etc/supervisor/conf.d/${service}.conf" > /dev/null << EOF
[program:${service}]
command=/home/ubuntu/healthcare-platform-complete/start-${service}.sh
directory=/home/ubuntu/healthcare-platform-complete
user=ubuntu
autostart=true
autorestart=true
stderr_logfile=/var/log/supervisor/${service}.err.log
stdout_logfile=/var/log/supervisor/${service}.out.log
environment=PATH="/home/ubuntu/healthcare-platform-complete/venv/bin"
stopwaitsecs=10
killasgroup=true
stopasgroup=true
EOF
done

# Create log directory
sudo mkdir -p /var/log/supervisor

success "Supervisor configurations created"

# Phase 6: Database Setup (Simplified - using SQLite for testing)
log "Phase 6: Setting up database..."

# Update environment to use SQLite for simplicity
cat > .env << EOF
# Database Configuration (SQLite for testing)
DATABASE_URL=sqlite:///./healthcare_platform.db
REDIS_URL=redis://localhost:6379

# Security Configuration
JWT_SECRET_KEY=healthcare-platform-super-secret-jwt-key-2025
ENCRYPTION_KEY=healthcare-platform-32-byte-key-2025

# API Keys (mock values for testing)
BALLERINE_API_KEY=test-ballerine-api-key
BALLERINE_API_URL=https://api.ballerine.com
OPENAI_API_KEY=test-openai-api-key

# Service Configuration
ENVIRONMENT=development
LOG_LEVEL=INFO
EOF

# Install SQLite support
pip install aiosqlite

success "Database configuration updated to use SQLite"

# Phase 7: Start Services
log "Phase 7: Starting all services..."

# Reload supervisor configuration
sudo supervisorctl reread
sudo supervisorctl update

# Start all services
log "Starting services with supervisor..."
for service in "${!services[@]}"; do
    log "Starting $service..."
    sudo supervisorctl start "$service" || warning "Failed to start $service"
    sleep 2  # Give each service time to start
done

success "All services startup initiated"

# Phase 8: Health Check Validation
log "Phase 8: Validating service health..."

# Wait for services to fully start
log "Waiting 10 seconds for services to initialize..."
sleep 10

# Check each service
failed_services=()
for service in "${!services[@]}"; do
    port=${services[$service]}
    log "Checking health of $service on port $port..."
    
    if curl -f -s "http://localhost:$port/health" > /dev/null 2>&1; then
        success "$service is healthy"
    else
        error "$service health check failed"
        failed_services+=("$service")
    fi
done

# Phase 9: Results Summary
echo ""
echo "=========================================="
echo "Deployment Results Summary"
echo "=========================================="

if [ ${#failed_services[@]} -eq 0 ]; then
    success "All services deployed successfully!"
    success "Integration tests should now pass"
else
    warning "Some services failed to start:"
    for service in "${failed_services[@]}"; do
        echo "  - $service"
    done
    echo ""
    echo "To troubleshoot:"
    echo "  sudo supervisorctl status"
    echo "  sudo tail -f /var/log/supervisor/[service-name].err.log"
fi

# Phase 10: Testing
log "Phase 10: Running integration tests..."

if [ ${#failed_services[@]} -eq 0 ]; then
    log "Running platform testing suite..."
    python3 platform-testing-suite.py
else
    warning "Skipping tests due to failed services"
fi

echo ""
echo "=========================================="
echo "Deployment Complete"
echo "=========================================="
echo ""
echo "Service Management Commands:"
echo "  sudo supervisorctl status          # Check service status"
echo "  sudo supervisorctl restart [name]  # Restart a service"
echo "  sudo supervisorctl stop all        # Stop all services"
echo "  sudo supervisorctl start all       # Start all services"
echo ""
echo "Log Locations:"
echo "  /var/log/supervisor/               # Service logs"
echo ""
echo "Health Check URLs:"
for service in "${!services[@]}"; do
    port=${services[$service]}
    echo "  http://localhost:$port/health    # $service"
done
echo ""

success "Deployment script completed!"
