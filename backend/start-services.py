#!/usr/bin/env python3
"""
Service Launcher for Georgetown Enhanced IDR Platform
Starts all backend microservices with proper configuration
"""

import subprocess
import time
import os
import sys
from pathlib import Path

# Service configuration
SERVICES = [
    {
        'name': 'Volume Management Service',
        'path': 'core-services/volume-management-service/main.py',
        'port': 5001,
        'env': {'FLASK_ENV': 'development', 'PORT': '5001'}
    },
    {
        'name': 'Predictive Analytics Service',
        'path': 'core-services/predictive-analytics-service/main.py',
        'port': 5002,
        'env': {'FLASK_ENV': 'development', 'PORT': '5002'}
    },
    {
        'name': 'IDR Entity Selection Service',
        'path': 'core-services/idr-entity-selection-service/main.py',
        'port': 5003,
        'env': {'FLASK_ENV': 'development', 'PORT': '5003'}
    },
    {
        'name': 'Third-Party Integration Service',
        'path': 'core-services/third-party-integration-service/main.py',
        'port': 5004,
        'env': {'FLASK_ENV': 'development', 'PORT': '5004'}
    },
    {
        'name': 'Enhanced Eligibility Validation Service',
        'path': 'core-services/enhanced-eligibility-validation-service/main.py',
        'port': 5005,
        'env': {'FLASK_ENV': 'development', 'PORT': '5005'}
    },
    {
        'name': 'Enhanced Entity Selection Service',
        'path': 'core-services/enhanced-entity-selection-service/main.py',
        'port': 5006,
        'env': {'FLASK_ENV': 'development', 'PORT': '5006'}
    },
    {
        'name': 'PUF Data Service',
        'path': 'core-services/puf-data-service/main.py',
        'port': 5007,
        'env': {'FLASK_ENV': 'development', 'PORT': '5007'}
    }
]

def start_service(service):
    """Start a single service"""
    print(f"Starting {service['name']} on port {service['port']}...")
    
    # Set environment variables
    env = os.environ.copy()
    env.update(service['env'])
    
    # Start the service
    try:
        process = subprocess.Popen(
            [sys.executable, service['path']],
            env=env,
            cwd=Path(__file__).parent,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        
        # Give the service a moment to start
        time.sleep(2)
        
        # Check if the service is still running
        if process.poll() is None:
            print(f"✅ {service['name']} started successfully (PID: {process.pid})")
            return process
        else:
            stdout, stderr = process.communicate()
            print(f"❌ {service['name']} failed to start")
            print(f"STDOUT: {stdout.decode()}")
            print(f"STDERR: {stderr.decode()}")
            return None
            
    except Exception as e:
        print(f"❌ Error starting {service['name']}: {e}")
        return None

def main():
    """Start all services"""
    print("🚀 Starting Georgetown Enhanced IDR Platform Services...")
    print("=" * 60)
    
    processes = []
    
    for service in SERVICES:
        process = start_service(service)
        if process:
            processes.append((service, process))
        time.sleep(1)  # Stagger service starts
    
    print("\n" + "=" * 60)
    print(f"✅ Started {len(processes)}/{len(SERVICES)} services successfully")
    
    if processes:
        print("\n📊 Service Status:")
        for service, process in processes:
            print(f"  • {service['name']}: http://localhost:{service['port']} (PID: {process.pid})")
        
        print("\n🔗 Integration Orchestrator: http://localhost:5000")
        print("🌐 React Frontend: http://localhost:5173")
        print("\n⚠️  Press Ctrl+C to stop all services")
        
        try:
            # Keep the script running and monitor services
            while True:
                time.sleep(5)
                # Check if any services have died
                for service, process in processes[:]:
                    if process.poll() is not None:
                        print(f"⚠️  {service['name']} has stopped unexpectedly")
                        processes.remove((service, process))
                
                if not processes:
                    print("❌ All services have stopped")
                    break
                    
        except KeyboardInterrupt:
            print("\n🛑 Stopping all services...")
            for service, process in processes:
                try:
                    process.terminate()
                    process.wait(timeout=5)
                    print(f"✅ Stopped {service['name']}")
                except subprocess.TimeoutExpired:
                    process.kill()
                    print(f"🔪 Force killed {service['name']}")
                except Exception as e:
                    print(f"⚠️  Error stopping {service['name']}: {e}")
    
    print("🏁 All services stopped")

if __name__ == "__main__":
    main()
