import { initializeTelemetry } from "./telemetry";

/**
 * This must be the process entrypoint. Dynamic import guarantees the SDK is
 * initialized before instrumented application modules are evaluated.
 */
async function bootstrap() {
  await initializeTelemetry();
  await import("./index.js");
}

bootstrap().catch(error => {
  console.error("[telemetry] bootstrap failed", error);
  process.exitCode = 1;
});
