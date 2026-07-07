#!/bin/bash

# Start GFE Management Service with Dapr sidecar
dapr run --app-id gfe-management-service --app-port 8027 --dapr-http-port 3500 --config ./dapr/config.yaml --components-path ./dapr/components -- python3 ../gfe-management-service/main.py &

# Start X12 EDI Processing Service with Dapr sidecar
dapr run --app-id x12-edi-processing-service --app-port 8028 --dapr-http-port 3501 --config ./dapr/config.yaml --components-path ./dapr/components -- python3 ../x12-edi-processing-service/main.py &

# Start CMS Portal Automation Service with Dapr sidecar
dapr run --app-id cms-portal-automation-service --app-port 8029 --dapr-http-port 3502 --config ./dapr/config.yaml --components-path ./dapr/components -- python3 ../cms-portal-automation-service/main.py &

# Start IDR Entity Integration Service with Dapr sidecar
dapr run --app-id idr-entity-integration-service --app-port 8030 --dapr-http-port 3503 --config ./dapr/config.yaml --components-path ./dapr/components -- python3 ../idr-entity-integration-service/main.py &

# Start Data Transformation Service with Dapr sidecar
dapr run --app-id data-transformation-service --app-port 8031 --dapr-http-port 3504 --config ./dapr/config.yaml --components-path ./dapr/components -- python3 ../data-transformation-service/main.py &

# Start Security Authentication Service with Dapr sidecar
dapr run --app-id security-authentication-service --app-port 8032 --dapr-http-port 3505 --config ./dapr/config.yaml --components-path ./dapr/components -- python3 ../security-authentication-service/main.py &

# Start API Gateway Service with Dapr sidecar
dapr run --app-id api-gateway-service --app-port 8025 --dapr-http-port 3506 --config ./dapr/config.yaml --components-path ./dapr/components -- python3 ../api-gateway-service/main.py &

echo "All services started with Dapr sidecars"
