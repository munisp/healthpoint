"""
Gunicorn production configuration for HealthPoint Flask services.
Usage: gunicorn -c gunicorn.conf.py "module:app"
"""
import multiprocessing
import os

# Server socket
bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"
backlog = 2048

# Worker processes
workers = multiprocessing.cpu_count() * 2 + 1
worker_class = "gevent"
worker_connections = 1000
timeout = 120
keepalive = 5

# Restart workers after this many requests (prevents memory leaks)
max_requests = 1000
max_requests_jitter = 50

# Logging
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info")
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'

# Security: never run as root
user = None  # Use the container's non-root user
group = None

# Process naming
proc_name = "healthpoint-service"

# SSL (handled by APISIX/nginx upstream, not here)
keyfile = None
certfile = None

# Preload app for faster worker startup and shared memory
preload_app = True

# Graceful timeout
graceful_timeout = 30

# Worker temp directory
worker_tmp_dir = "/dev/shm"

def on_starting(server):
    server.log.info("HealthPoint service starting (Gunicorn production mode)")

def on_exit(server):
    server.log.info("HealthPoint service shutting down")

def worker_exit(server, worker):
    server.log.info(f"Worker {worker.pid} exiting")
