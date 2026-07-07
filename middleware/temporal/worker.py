from temporalio.worker import Worker
from temporalio.client import Client
from gfe_workflow import GFEWorkflow

async def main():
    client = await Client.connect("localhost:7233")
    worker = Worker(
        client,
        task_queue="gfe-task-queue",
        workflows=[GFEWorkflow],
        activities=[generate_gfe, send_gfe_to_patient, finalize_gfe],
    )
    await worker.run()

@activity.defn
async def generate_gfe(gfe_id: str) -> dict:
    # ... implementation ...
    return {"gfe_id": gfe_id, "status": "generated"}

@activity.defn
async def send_gfe_to_patient(gfe: dict):
    # ... implementation ...
    pass

@activity.defn
async def finalize_gfe(gfe_id: str):
    # ... implementation ...
    pass

