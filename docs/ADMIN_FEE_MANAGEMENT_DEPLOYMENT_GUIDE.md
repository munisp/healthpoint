# **Admin Fee Management Dashboard - Deployment Guide**

**Author:** Manus AI  
**Date:** October 8, 2025  
**Version:** 2.0.0

## **Quick Start Deployment**

### **Prerequisites**

Ensure the following components are installed and running:
- Docker and Docker Compose
- PostgreSQL 15+ (or use the containerized version)
- Redis 7+ (or use the containerized version)
- Node.js 18+ (for development)
- Python 3.11+ (for development)

### **1. Database Setup**

Initialize the database schema and populate with initial data:

```bash
# Apply the admin fee management schema
psql -d postgresql://user:password@localhost/nsa_idr_db -f database/admin_fee_management_schema.sql

# Load initial data
psql -d postgresql://user:password@localhost/nsa_idr_db -f database/initial_data.sql
```

### **2. Backend Service Deployment**

Deploy the enhanced admin fee management service:

```bash
# Build the Docker image
docker build -f Dockerfile.admin-fee -t healthcare-admin-fee .

# Run the service
docker run -d \
  --name healthcare-admin-fee \
  -p 8026:8026 \
  -e DATABASE_URL=postgresql://user:password@localhost/nsa_idr_db \
  -e REDIS_URL=redis://localhost:6379 \
  healthcare-admin-fee
```

### **3. Frontend Dashboard Deployment**

Deploy the React-based admin dashboard:

```bash
# Navigate to the dashboard directory
cd admin-fee-dashboard-enhanced

# Install dependencies
npm install

# Build for production
npm run build

# Serve the built application
npm run preview --host --port 3001
```

### **4. Docker Compose Deployment**

For complete platform deployment, use the updated docker-compose.yml:

```bash
# Start all services including the new admin fee management components
docker-compose up -d admin-fee-management admin-fee-dashboard

# Verify services are running
docker-compose ps
```

## **Configuration**

### **Environment Variables**

| **Variable** | **Description** | **Default** |
|--------------|-----------------|-------------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:password@localhost/nsa_idr_db` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `REACT_APP_API_BASE_URL` | Backend API URL for frontend | `http://localhost:8026` |

### **Service Endpoints**

- **Backend API**: http://localhost:8026
- **Frontend Dashboard**: http://localhost:3001
- **WebSocket**: ws://localhost:8026/ws

## **Health Checks**

Verify the deployment with these health check endpoints:

```bash
# Backend service health
curl http://localhost:8026/health

# Frontend accessibility
curl http://localhost:3001

# Database connectivity test
curl http://localhost:8026/admin/fees
```

## **Security Configuration**

### **Authentication**

The current implementation uses a simplified token-based authentication. For production deployment:

1. Replace the demo token with a secure, randomly generated token
2. Implement proper user management and role-based access control
3. Configure HTTPS for all communications
4. Set up proper firewall rules to restrict access

### **Database Security**

1. Use strong, unique passwords for database connections
2. Configure PostgreSQL to accept connections only from authorized hosts
3. Enable SSL/TLS for database connections
4. Regularly backup the database and test restore procedures

## **Monitoring and Logging**

### **Application Logs**

Monitor the following log locations:

- Backend service logs: Docker container logs or `/var/log/admin-fee-management.log`
- Frontend access logs: Web server access logs
- Database logs: PostgreSQL log files

### **Performance Monitoring**

Key metrics to monitor:

- API response times
- Database query performance
- WebSocket connection counts
- Memory and CPU utilization

## **Troubleshooting**

### **Common Issues**

**Service fails to start:**
- Verify database connectivity
- Check environment variable configuration
- Ensure required ports are available

**Dashboard not loading:**
- Verify backend service is running
- Check CORS configuration
- Validate API endpoint URLs

**Real-time updates not working:**
- Verify WebSocket connection
- Check firewall settings for WebSocket traffic
- Monitor browser console for connection errors

### **Debug Mode**

Enable debug logging for troubleshooting:

```bash
# Backend service debug mode
export LOG_LEVEL=DEBUG

# Frontend development mode
npm run dev
```

## **Backup and Recovery**

### **Database Backup**

```bash
# Create database backup
pg_dump postgresql://user:password@localhost/nsa_idr_db > admin_fee_backup.sql

# Restore from backup
psql -d postgresql://user:password@localhost/nsa_idr_db < admin_fee_backup.sql
```

### **Configuration Export**

Use the built-in export functionality:

```bash
# Export current configuration
curl -H "Authorization: Bearer admin-token-123" \
  http://localhost:8026/admin/export > config_backup.json
```

## **Updates and Maintenance**

### **Service Updates**

1. Stop the running services
2. Pull the latest code changes
3. Rebuild Docker images
4. Apply any database migrations
5. Restart services
6. Verify functionality

### **Database Migrations**

For schema updates, create migration scripts and apply them in sequence:

```bash
# Apply migration
psql -d postgresql://user:password@localhost/nsa_idr_db -f migration_001.sql
```

This deployment guide ensures successful implementation of the Admin Fee Management Dashboard within your NSA/IDR Healthcare Claims Platform infrastructure.
