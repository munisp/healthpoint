"""
HealthPoint IDR — Lakehouse pipeline scheduler stub (Phase 15 FB / audit B6).

STATUS: the PySpark → Iceberg-on-MinIO pipeline (pipeline.py) is real code,
but NOTHING schedules it: docker-compose.yml has no Spark service and no cron
entry. This module is the honest scheduling entrypoint.

Behavior:
  - LAKEHOUSE_SCHEDULE_ENABLED != "true" (default): logs that scheduling is
    UNCONFIGURED and exits 0. No run is faked; no "success" is reported.
  - LAKEHOUSE_SCHEDULE_ENABLED == "true": invokes pipeline.py once via
    subprocess and propagates its real exit code. Interval orchestration
    (cron / Airflow / compose one-shot) is the deployer's responsibility —
    see docker-compose.yml and docs.

Never report a scheduled run that did not execute.
"""

import logging
import os
import subprocess
import sys

logger = logging.getLogger("lakehouse-scheduler")
logging.basicConfig(level=logging.INFO)


def main() -> int:
    if os.environ.get("LAKEHOUSE_SCHEDULE_ENABLED", "").strip().lower() != "true":
        logger.warning(
            "Lakehouse scheduling is UNCONFIGURED (LAKEHOUSE_SCHEDULE_ENABLED is not 'true'). "
            "The Spark/Iceberg pipeline was NOT run. Set LAKEHOUSE_SCHEDULE_ENABLED=true and "
            "provide Spark + MinIO infrastructure to execute it for real."
        )
        return 0
    logger.info("LAKEHOUSE_SCHEDULE_ENABLED=true — running services/lakehouse/pipeline.py")
    proc = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "pipeline.py")])
    if proc.returncode != 0:
        logger.error("Lakehouse pipeline FAILED with exit code %d", proc.returncode)
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
