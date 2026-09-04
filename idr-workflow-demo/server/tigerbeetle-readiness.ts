import {
  getTigerBeetleConfiguration,
  startTigerBeetleTunnel,
  stopTigerBeetleTunnel,
  verifyTigerBeetleReadConnectivity,
} from "./tigerbeetle";

async function main(): Promise<void> {
  if (process.env.TIGERBEETLE_READINESS_MODE !== "read-only") {
    throw new Error("TIGERBEETLE_READINESS_MODE must be read-only");
  }
  if (process.env.PAYMENT_EXECUTION_MODE === "enabled") {
    throw new Error("TigerBeetle readiness job cannot run while payment execution is enabled");
  }

  const config = getTigerBeetleConfiguration();
  await startTigerBeetleTunnel();
  try {
    const result = await verifyTigerBeetleReadConnectivity(10_000);
    process.stdout.write(`${JSON.stringify({
      result: "read_connectivity_verified",
      address: result.address,
      accountsReturned: result.accountsReturned,
      tlsServerName: config.tlsServerName,
      clusterId: config.clusterId.toString(),
    })}\n`);
  } finally {
    await stopTigerBeetleTunnel();
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "unknown readiness error";
  process.stderr.write(`${JSON.stringify({ result: "read_connectivity_failed", message })}\n`);
  process.exitCode = 1;
});
