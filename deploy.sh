#!/bin/bash

# Healthcare Claims Platform Deployment Script
# This script deploys the complete healthcare platform with all services

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PLATFORM_NAME="Healthcare Claims Platform"
VERSION="1.0.0"
ENVIRONMENT=${ENVIRONMENT:-development}
COMPOSE_FILE="docker-compose.yml"

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE} $1${NC}"
    echo -e "${BLUE}================================${NC}"
}

# Function to check prerequisites
check_prerequisites() {
    print_header "Checking Prerequisites"
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    print_status "Docker: $(docker --version)"
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    print_status "Docker Compose: $(docker-compose --version)"
    
    # Check available disk space (minimum 10GB)
    available_space=$(df -BG . | awk 'NR==2 {print $4}' | sed 's/G//')
    if [ "$available_space" -lt 10 ]; then
        print_warning "Available disk space is less than 10GB. Platform may not work properly."
    fi
    print_status "Available disk space: ${available_space}GB"
    
    # Check available memory (minimum 8GB)
    available_memory=$(free -g | awk 'NR==2{print $2}')
    if [ "$available_memory" -lt 8 ]; then
        print_warning "Available memory is less than 8GB. Platform may not work properly."
    fi
    print_status "Available memory: ${available_memory}GB"
}

# Function to create environment file
create_env_file() {
    print_header "Creating Environment Configuration"
    
    if [ ! -f .env ]; then
        print_status "Creating .env file..."
        cat > .env << EOF
# Healthcare Claims Platform Environment Configuration
ENVIRONMENT=${ENVIRONMENT}
PLATFORM_VERSION=${VERSION}

# Database Configuration
POSTGRES_PASSWORD=healthpass123
DATABASE_URL=postgresql://healthuser:healthpass123@postgres:5432/healthcare_platform

# Redis Configuration
REDIS_URL=redis://redis:6379

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-in-production-$(openssl rand -hex 32)

# Email Configuration (Update with your SMTP settings)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# MLflow Configuration
MLFLOW_TRACKING_URI=http://mlflow:5000

# Security Configuration
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Monitoring Configuration
MONITORING_ENABLED=true
METRICS_ENABLED=true

# Backup Configuration
BACKUP_ENABLED=true
BACKUP_RETENTION_DAYS=30

# Development/Debug Settings
DEBUG=${DEBUG:-false}
LOG_LEVEL=${LOG_LEVEL:-INFO}
EOF
        print_status "Environment file created successfully"
    else
        print_status "Environment file already exists"
    fi
}

# Function to create necessary directories
create_directories() {
    print_header "Creating Directories"
    
    directories=(
        "nginx/ssl"
        "data/postgres"
        "data/redis"
        "data/mlflow"
        "data/models"
        "data/documents"
        "data/backups"
        "logs"
    )
    
    for dir in "${directories[@]}"; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir"
            print_status "Created directory: $dir"
        fi
    done
}

# Function to generate SSL certificates (self-signed for development)
generate_ssl_certificates() {
    print_header "Generating SSL Certificates"
    
    if [ ! -f "nginx/ssl/cert.pem" ] || [ ! -f "nginx/ssl/key.pem" ]; then
        print_status "Generating self-signed SSL certificates..."
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout nginx/ssl/key.pem \
            -out nginx/ssl/cert.pem \
            -subj "/C=US/ST=State/L=City/O=Healthcare/OU=IT/CN=localhost"
        print_status "SSL certificates generated successfully"
    else
        print_status "SSL certificates already exist"
    fi
}

# Function to build Docker images
build_images() {
    print_header "Building Docker Images"
    
    print_status "Building all service images..."
    docker-compose build --parallel
    print_status "All images built successfully"
}

# Function to start services
start_services() {
    print_header "Starting Services"
    
    print_status "Starting infrastructure services (Database, Redis, MLflow)..."
    docker-compose up -d postgres redis mlflow
    
    print_status "Waiting for database to be ready..."
    sleep 30
    
    print_status "Starting backend services..."
    docker-compose up -d \
        api-gateway \
        ai-fraud-detection \
        claims-processing \
        provider-management \
        patient-management \
        audit-compliance \
        notification \
        analytics-reporting \
        user-management \
        document-management \
        integration \
        workflow-engine \
        configuration \
        monitoring \
        backup \
        security
    
    print_status "Waiting for backend services to be ready..."
    sleep 30
    
    print_status "Starting frontend and proxy..."
    docker-compose up -d frontend nginx
    
    print_status "All services started successfully"
}

# Function to check service health
check_health() {
    print_header "Checking Service Health"
    
    services=(
        "postgres:5432"
        "redis:6379"
        "mlflow:5000"
        "api-gateway:8000"
        "ai-fraud-detection:8001"
        "claims-processing:8002"
        "provider-management:8003"
        "patient-management:8004"
        "audit-compliance:8005"
        "notification:8006"
        "analytics-reporting:8007"
        "user-management:8008"
        "document-management:8009"
        "integration:8010"
        "workflow-engine:8011"
        "configuration:8012"
        "monitoring:8013"
        "backup:8014"
        "security:8015"
        "frontend:3000"
        "nginx:80"
    )
    
    for service in "${services[@]}"; do
        service_name=$(echo $service | cut -d':' -f1)
        port=$(echo $service | cut -d':' -f2)
        
        if docker-compose ps | grep -q "${service_name}.*Up"; then
            print_status "✓ $service_name is running"
        else
            print_error "✗ $service_name is not running"
        fi
    done
}

# Function to show deployment summary
show_summary() {
    print_header "Deployment Summary"
    
    echo -e "${GREEN}🎉 ${PLATFORM_NAME} v${VERSION} deployed successfully!${NC}"
    echo ""
    echo -e "${BLUE}Access URLs:${NC}"
    echo -e "  • Main Application: ${GREEN}http://localhost${NC}"
    echo -e "  • API Gateway: ${GREEN}http://localhost:8000${NC}"
    echo -e "  • MLflow UI: ${GREEN}http://localhost:5000${NC}"
    echo ""
    echo -e "${BLUE}Service Ports:${NC}"
    echo -e "  • AI Fraud Detection: ${GREEN}http://localhost:8001${NC}"
    echo -e "  • Claims Processing: ${GREEN}http://localhost:8002${NC}"
    echo -e "  • Provider Management: ${GREEN}http://localhost:8003${NC}"
    echo -e "  • Patient Management: ${GREEN}http://localhost:8004${NC}"
    echo -e "  • Audit & Compliance: ${GREEN}http://localhost:8005${NC}"
    echo -e "  • Notifications: ${GREEN}http://localhost:8006${NC}"
    echo -e "  • Analytics & Reports: ${GREEN}http://localhost:8007${NC}"
    echo -e "  • User Management: ${GREEN}http://localhost:8008${NC}"
    echo -e "  • Document Management: ${GREEN}http://localhost:8009${NC}"
    echo -e "  • Integration Service: ${GREEN}http://localhost:8010${NC}"
    echo -e "  • Workflow Engine: ${GREEN}http://localhost:8011${NC}"
    echo -e "  • Configuration: ${GREEN}http://localhost:8012${NC}"
    echo -e "  • Monitoring: ${GREEN}http://localhost:8013${NC}"
    echo -e "  • Backup Service: ${GREEN}http://localhost:8014${NC}"
    echo -e "  • Security Service: ${GREEN}http://localhost:8015${NC}"
    echo ""
    echo -e "${BLUE}Database Access:${NC}"
    echo -e "  • PostgreSQL: ${GREEN}localhost:5432${NC}"
    echo -e "  • Redis: ${GREEN}localhost:6379${NC}"
    echo ""
    echo -e "${BLUE}Default Credentials:${NC}"
    echo -e "  • Username: ${GREEN}admin${NC}"
    echo -e "  • Password: ${GREEN}admin123${NC}"
    echo ""
    echo -e "${YELLOW}Next Steps:${NC}"
    echo -e "  1. Update SMTP settings in .env file for email notifications"
    echo -e "  2. Configure SSL certificates for production deployment"
    echo -e "  3. Review and update security settings"
    echo -e "  4. Set up monitoring and alerting"
    echo -e "  5. Configure backup schedules"
    echo ""
    echo -e "${BLUE}Useful Commands:${NC}"
    echo -e "  • View logs: ${GREEN}docker-compose logs -f [service_name]${NC}"
    echo -e "  • Stop platform: ${GREEN}docker-compose down${NC}"
    echo -e "  • Restart service: ${GREEN}docker-compose restart [service_name]${NC}"
    echo -e "  • Update platform: ${GREEN}docker-compose pull && docker-compose up -d${NC}"
}

# Function to handle cleanup on exit
cleanup() {
    if [ $? -ne 0 ]; then
        print_error "Deployment failed. Cleaning up..."
        docker-compose down
    fi
}

# Main deployment function
main() {
    print_header "Healthcare Claims Platform Deployment"
    echo -e "${BLUE}Version: ${VERSION}${NC}"
    echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"
    echo ""
    
    # Set trap for cleanup
    trap cleanup EXIT
    
    # Run deployment steps
    check_prerequisites
    create_env_file
    create_directories
    generate_ssl_certificates
    build_images
    start_services
    
    # Wait a bit for services to fully start
    print_status "Waiting for services to fully initialize..."
    sleep 60
    
    check_health
    show_summary
    
    print_status "Deployment completed successfully!"
}

# Handle command line arguments
case "${1:-deploy}" in
    "deploy")
        main
        ;;
    "stop")
        print_header "Stopping Platform"
        docker-compose down
        print_status "Platform stopped successfully"
        ;;
    "restart")
        print_header "Restarting Platform"
        docker-compose restart
        print_status "Platform restarted successfully"
        ;;
    "logs")
        docker-compose logs -f "${2:-}"
        ;;
    "status")
        check_health
        ;;
    "update")
        print_header "Updating Platform"
        docker-compose pull
        docker-compose up -d
        print_status "Platform updated successfully"
        ;;
    "clean")
        print_header "Cleaning Up"
        docker-compose down -v --remove-orphans
        docker system prune -f
        print_status "Cleanup completed"
        ;;
    *)
        echo "Usage: $0 {deploy|stop|restart|logs [service]|status|update|clean}"
        echo ""
        echo "Commands:"
        echo "  deploy   - Deploy the complete platform"
        echo "  stop     - Stop all services"
        echo "  restart  - Restart all services"
        echo "  logs     - View logs (optionally for specific service)"
        echo "  status   - Check service health"
        echo "  update   - Update and restart platform"
        echo "  clean    - Remove all containers and volumes"
        exit 1
        ;;
esac
