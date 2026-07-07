from temporalio import workflow

@workflow.defn
class GFEWorkflow:
    @workflow.run
    async def run(self, gfe_id: str) -> str:
        # 1. Generate GFE
        gfe = await workflow.execute_activity(
            "generate_gfe", gfe_id, schedule_to_close_timeout=timedelta(seconds=5)
        )

        # 2. Send GFE to patient
        await workflow.execute_activity(
            "send_gfe_to_patient", gfe, schedule_to_close_timeout=timedelta(seconds=5)
        )

        # 3. Wait for patient confirmation
        await workflow.wait_for_external_event("patient_confirmation")

        # 4. Finalize GFE
        await workflow.execute_activity(
            "finalize_gfe", gfe_id, schedule_to_close_timeout=timedelta(seconds=5)
        )

        return "GFE workflow completed"

