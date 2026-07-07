# Healthcare Claims Platform - Deployment Guide

**Author:** Manus AI  
**Date:** October 7, 2025

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Pre-deployment Setup](#pre-deployment-setup)
3. [Database Configuration](#database-configuration)
4. [Application Deployment](#application-deployment)
5. [AI/ML/DL Model Setup](#aimlDL-model-setup)
6. [Service Verification](#service-verification)
7. [Production Considerations](#production-considerations)
8. [Troubleshooting](#troubleshooting)

## System Requirements

### Minimum Hardware Requirements
- **CPU:** 4 cores, 2.4 GHz
- **RAM:** 8 GB
- **Storage:** 50 GB SSD
- **Network:** 1 Gbps connection

### Recommended Hardware Requirements
- **CPU:** 8 cores, 3.0 GHz
- **RAM:** 16 GB
- **Storage:** 100 GB SSD
- **Network:** 10 Gbps connection

### Software Requirements
- **Operating System:** Ubuntu 20.04+ or CentOS 8+
- **Python:** 3.11+
- **PostgreSQL:** 13+
- **Redis:** 6+
- **Supervisor:** 4.0+ (for production)

## Pre-deployment Setup

### 1. System Updates
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3.11 python3.11-venv python3-pip
sudo apt install -y postgresql postgresql-contrib redis-server
sudo apt install -y supervisor nginx  # Optional for production
```

### 2. User Setup
```bash
# Create application user (recommended for production)
sudo useradd -m -s /bin/bash healthcare
sudo usermod -aG sudo healthcare
su - healthcare
```

### 3. Directory Structure
```bash
mkdir -p /opt/healthcare-platform
cd /opt/healthcare-platform
# Extract unified artifact here
```

## Database Configuration

### PostgreSQL Setup

1. **Start PostgreSQL Service**
   ```bash
   sudo systemctl start postgresql
   sudo systemctl enable postgresql
   ```

2. **Create Database and User**
   ```bash
   sudo -u postgres psql
   ```
   ```sql
   CREATE USER claimuser WITH PASSWORD 'secure_password_here';
   CREATE DATABASE healthcare_platform OWNER claimuser;
   GRANT ALL PRIVILEGES ON DATABASE healthcare_platform TO claimuser;
   \q
   ```

3. **Configure PostgreSQL**
   ```bash
   sudo nano /etc/postgresql/13/main/postgresql.conf
   # Uncomment and modify:
   # listen_addresses = 'localhost'
   # max_connections = 200
   
   sudo nano /etc/postgresql/13/main/pg_hba.conf
   # Add line:
   # local   healthcare_platform   claimuser                     md5
   
   sudo systemctl restart postgresql
   ```

### Redis Setup

1. **Start Redis Service**
   ```bash
   sudo systemctl start redis-server
   sudo systemctl enable redis-server
   ```

2. **Configure Redis**
   ```bash
   sudo nano /etc/redis/redis.conf
   # Modify:
   # maxmemory 2gb
   # maxmemory-policy allkeys-lru
   
   sudo systemctl restart redis-server
   ```

## Application Deployment

### 1. Environment Setup
```bash
cd /opt/healthcare-platform
python3.11 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 2. Configuration
```bash
cp .env.example .env
nano .env
# Update database credentials and other settings
```

### 3. Database Schema Creation
```bash
# Run the training data collection script to create tables
python3 ai-ml-dl-implementation/training_data_collection_system.py
```

### 4. Service Deployment

#### Option A: Development Deployment
```bash
# Make scripts executable
chmod +x *.sh

# Start services individually
./start-api-gateway-service.sh &
./start-authentication-service.sh &
./start-claims-processing-service.sh &
./start-ai-fraud-detection-service.sh &
# ... continue for all services
```

#### Option B: Production Deployment
```bash
# Use the unified deployment script
chmod +x unified_deployment_script.sh
./unified_deployment_script.sh
```

## AI/ML/DL Model Setup

### 1. Start MLflow Server
```bash
# In a separate terminal or as a service
mlflow server --host 0.0.0.0 --port 5000 --backend-store-uri sqlite:///mlflow.db &
```

### 2. Generate Training Data
```bash
python3 ai-ml-dl-implementation/training_data_collection_system.py
```

### 3. Train Models
```bash
python3 ai-ml-dl-implementation/model_training_pipeline.py
```

### 4. Verify Model Registration
```bash
# Check MLflow UI at http://localhost:5000
# Verify models are registered and available
```

## Service Verification

### 1. Health Checks
```bash
# Check all services
for port in {8001..8017}; do
    echo "Checking service on port $port"
    curl -f http://localhost:$port/health || echo "Service on port $port failed"
done
```

### 2. API Documentation
Visit the following URLs to verify services:
- API Gateway: http://localhost:8001/docs
- AI Fraud Detection: http://localhost:8009/docs
- Claims Processing: http://localhost:8004/docs

### 3. Integration Tests
```bash
python3 integration_testing_suite.py
python3 ai-ml-dl-implementation/testing_suite.py
```

## Production Considerations

### 1. Security Hardening

#### Firewall Configuration
```bash
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# Only allow internal access to service ports
sudo ufw allow from 10.0.0.0/8 to any port 8001:8017
```

#### SSL/TLS Setup
```bash
# Install Certbot for Let's Encrypt
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 2. Monitoring Setup

#### Log Aggregation
```bash
# Configure rsyslog for centralized logging
sudo nano /etc/rsyslog.d/50-healthcare.conf
# Add:
# local0.*    /var/log/healthcare/platform.log
```

#### Health Monitoring
```bash
# Create monitoring script
cat > /opt/healthcare-platform/monitor.sh << 'EOF'
#!/bin/bash
for port in {8001..8017}; do
    if ! curl -f http://localhost:$port/health > /dev/null 2>&1; then
        echo "$(date): Service on port $port is down" >> /var/log/healthcare/alerts.log
        # Add alerting mechanism here
    fi
done
EOF

# Add to crontab
echo "*/5 * * * * /opt/healthcare-platform/monitor.sh" | crontab -
```

### 3. Backup Strategy

#### Database Backup
```bash
# Create backup script
cat > /opt/healthcare-platform/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/opt/backups/healthcare"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# Database backup
pg_dump -h localhost -U claimuser healthcare_platform > $BACKUP_DIR/db_$DATE.sql

# Model backup
cp -r ai-ml-dl-implementation/models $BACKUP_DIR/models_$DATE

# Clean old backups (keep 7 days)
find $BACKUP_DIR -name "*.sql" -mtime +7 -delete
find $BACKUP_DIR -name "models_*" -mtime +7 -exec rm -rf {} \;
EOF

# Schedule daily backups
echo "0 2 * * * /opt/healthcare-platform/backup.sh" | crontab -
```

### 4. Performance Optimization

#### Database Tuning
```sql
-- Connect to PostgreSQL and run:
ALTER SYSTEM SET shared_buffers = '2GB';
ALTER SYSTEM SET effective_cache_size = '6GB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
SELECT pg_reload_conf();
```

#### Application Tuning
```bash
# Increase file descriptor limits
echo "healthcare soft nofile 65536" | sudo tee -a /etc/security/limits.conf
echo "healthcare hard nofile 65536" | sudo tee -a /etc/security/limits.conf
```

## Troubleshooting

### Common Issues

#### 1. Service Won't Start
```bash
# Check logs
sudo journalctl -u supervisor
tail -f /var/log/supervisor/*.log

# Check port conflicts
sudo netstat -tulpn | grep :8001
```

#### 2. Database Connection Issues
```bash
# Test connection
psql -h localhost -U claimuser -d healthcare_platform

# Check PostgreSQL status
sudo systemctl status postgresql
```

#### 3. Model Loading Errors
```bash
# Check MLflow server
curl http://localhost:5000/health

# Verify model files
ls -la ai-ml-dl-implementation/models/
```

#### 4. Memory Issues
```bash
# Monitor memory usage
free -h
top -p $(pgrep -d',' python)

# Adjust service memory limits if needed
```

### Log Locations
- **Supervisor logs:** `/var/log/supervisor/`
- **Application logs:** `/var/log/healthcare/`
- **PostgreSQL logs:** `/var/log/postgresql/`
- **Redis logs:** `/var/log/redis/`

### Support Contacts
For deployment issues, consult:
- Platform Documentation: `unified_platform_documentation.md`
- AI/ML/DL Guide: `ai-ml-dl-implementation/README.md`
- Integration Reports: `connection-errors-resolution-final-report.md`

---

**Note:** This deployment guide provides comprehensive instructions for both development and production environments. Always test deployments in a staging environment before production deployment.
