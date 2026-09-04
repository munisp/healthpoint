import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { mkdtemp, readFile, rm, writeFile, chmod, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { observeDependencyOperation } from "./_core/telemetry";
import {
  recordTigerBeetleReadProbe,
  recordTigerBeetleTunnelReady,
  recordTigerBeetleTunnelStartAttempt,
  recordTigerBeetleTunnelStopped,
  registerTigerBeetleReadClient,
} from "./tigerbeetle-lifecycle-metrics";
import type { Client, Transfer } from "tigerbeetle-node";


export class TigerBeetleConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TigerBeetleConfigurationError";
  }
}

export type TigerBeetleConfiguration = {
  clusterId: bigint;
  localAddress: string;
  remoteAddress: string;
  tlsServerName: string;
  caPath: string;
  clientCertPath: string;
  clientKeyPath?: string;
  clientKeyPem?: string;
};

type TunnelState = {
  child: ChildProcess;
  workspace: string;
  startedAt: number;
  ready: boolean;
};

let tunnelState: TunnelState | null = null;
let startingTunnel: Promise<void> | null = null;
let lastTunnelError: string | null = null;

function readEnabledFlag(): boolean {
  return process.env.TIGERBEETLE_ENABLED === "true";
}

function isLoopbackAddress(address: string): boolean {
  return /^127\.0\.0\.1:\d{1,5}$/.test(address) || /^\[::1\]:\d{1,5}$/.test(address);
}

function isHostPort(address: string): boolean {
  const match = /^([^:\s]+):(\d{1,5})$/.exec(address);
  if (!match) return false;
  const port = Number(match[2]);
  return port > 0 && port < 65536;
}

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value.includes("\0")) {
    throw new TigerBeetleConfigurationError(`${name} must be explicitly configured and must not contain a NUL character`);
  }
  return value;
}

function configuredPath(name: string): string {
  return requiredEnvironmentValue(name);
}

/**
 * Reads only the mutually authenticated, loopback-only connection settings.
 * The TigerBeetle client speaks clear TCP only to its local stunnel process;
 * direct remote connections are rejected so the mTLS control cannot be bypassed.
 */
export function getTigerBeetleConfiguration(): TigerBeetleConfiguration {
  const localAddress = requiredEnvironmentValue("TIGERBEETLE_ADDRESS");
  const remoteAddress = requiredEnvironmentValue("TIGERBEETLE_TLS_REMOTE_ADDRESS");
  const tlsServerName = requiredEnvironmentValue("TIGERBEETLE_TLS_SERVER_NAME");
  const rawClusterId = requiredEnvironmentValue("TIGERBEETLE_CLUSTER_ID");
  const clientKeyPath = process.env.TIGERBEETLE_CLIENT_KEY_PATH?.trim();
  const clientKeyPem = process.env.TIGERBEETLE_CLIENT_KEY_PEM;

  if (!isLoopbackAddress(localAddress)) {
    throw new TigerBeetleConfigurationError("TIGERBEETLE_ADDRESS must be a loopback stunnel address; direct remote client connections are prohibited");
  }
  if (!isHostPort(remoteAddress) || isLoopbackAddress(remoteAddress)) {
    throw new TigerBeetleConfigurationError("TIGERBEETLE_TLS_REMOTE_ADDRESS must be a non-loopback host:port");
  }
  if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(tlsServerName)) {
    throw new TigerBeetleConfigurationError("TIGERBEETLE_TLS_SERVER_NAME must be a DNS hostname for strict certificate validation");
  }

  let clusterId: bigint;
  try {
    clusterId = BigInt(rawClusterId);
  } catch {
    throw new TigerBeetleConfigurationError("TIGERBEETLE_CLUSTER_ID must be an unsigned integer");
  }
  if (clusterId <= BigInt(0)) {
    throw new TigerBeetleConfigurationError("TIGERBEETLE_CLUSTER_ID must be positive");
  }
  if (clientKeyPath && clientKeyPem) {
    throw new TigerBeetleConfigurationError("Configure exactly one of TIGERBEETLE_CLIENT_KEY_PATH or TIGERBEETLE_CLIENT_KEY_PEM");
  }

  return {
    clusterId,
    localAddress,
    remoteAddress,
    tlsServerName,
    caPath: configuredPath("TIGERBEETLE_CA_PATH"),
    clientCertPath: configuredPath("TIGERBEETLE_CLIENT_CERT_PATH"),
    clientKeyPath,
    clientKeyPem,
  };
}

async function waitForLoopbackPort(address: string, timeoutMs = 8_000): Promise<void> {
  const separator = address.lastIndexOf(":");
  const host = address.slice(0, separator).replace(/^\[(.*)\]$/, "$1");
  const port = Number(address.slice(separator + 1));
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>(resolve => {
      const socket = createConnection({ host, port });
      const settle = (value: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(value);
      };
      socket.once("connect", () => settle(true));
      socket.once("error", () => settle(false));
      socket.setTimeout(500, () => settle(false));
    });
    if (connected) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new TigerBeetleConfigurationError(`TigerBeetle stunnel did not bind ${address} within ${timeoutMs}ms`);
}

function quoteStunnelValue(value: string): string {
  if (/\r|\n/.test(value)) throw new TigerBeetleConfigurationError("TLS configuration values must not contain line breaks");
  return value;
}

/** Starts one local stunnel child process with certificate-chain and hostname validation enforced. */
export async function startTigerBeetleTunnel(): Promise<void> {
  if (tunnelState) return;
  if (startingTunnel) return startingTunnel;

  startingTunnel = (async () => {
    lastTunnelError = null;
    const config = getTigerBeetleConfiguration();
    if (!config.clientKeyPath && !config.clientKeyPem) {
      throw new TigerBeetleConfigurationError("TigerBeetle mTLS client key is required before the tunnel can start");
    }
    await Promise.all([
      access(config.caPath, fsConstants.R_OK),
      access(config.clientCertPath, fsConstants.R_OK),
      config.clientKeyPath ? access(config.clientKeyPath, fsConstants.R_OK) : Promise.resolve(),
    ]);

    const workspace = await mkdtemp(join(tmpdir(), "healthpoint-tigerbeetle-"));
    await chmod(workspace, 0o700);
    const keyPath = config.clientKeyPath || join(workspace, "client.key");
    if (config.clientKeyPem) {
      await writeFile(keyPath, config.clientKeyPem, { mode: 0o600 });
      await chmod(keyPath, 0o600);
    }

    const configPath = join(workspace, "stunnel.conf");
    const stunnelConfig = [
      "foreground = yes",
      "client = yes",
      "debug = 4",
      "sslVersionMin = TLSv1.2",
      "verifyChain = yes",
      "checkHost = " + quoteStunnelValue(config.tlsServerName),
      "",
      "[healthpoint-tigerbeetle]",
      "accept = " + quoteStunnelValue(config.localAddress),
      "connect = " + quoteStunnelValue(config.remoteAddress),
      "CAfile = " + quoteStunnelValue(config.caPath),
      "cert = " + quoteStunnelValue(config.clientCertPath),
      "key = " + quoteStunnelValue(keyPath),
      "",
    ].join("\n");
    await writeFile(configPath, stunnelConfig, { mode: 0o600 });
    await chmod(configPath, 0o600);

    recordTigerBeetleTunnelStartAttempt();
    const child = spawn("stunnel", [configPath], { stdio: ["ignore", "ignore", "pipe"] });
    const errorLines: string[] = [];
    child.stderr?.on("data", chunk => {
      errorLines.push(String(chunk));
      if (errorLines.length > 20) errorLines.shift();
    });
    child.once("error", error => {
      console.error("[TigerBeetle] stunnel process could not start", error);
    });
    const state: TunnelState = { child, workspace, startedAt: Date.now(), ready: false };
    tunnelState = state;
    child.once("exit", () => {
      // A normal stop clears tunnelState before terminating the child. Any exit
      // that still owns the current state is an observable failure, never a retry.
      if (tunnelState?.child !== child) return;
      tunnelState = null;
      const reason = state.ready ? "unexpected_exit" : "startup_failure";
      recordTigerBeetleTunnelStopped(reason, Date.now() - state.startedAt);
      lastTunnelError = "TigerBeetle stunnel exited unexpectedly";
      void rm(workspace, { recursive: true, force: true });
    });

    try {
      await waitForLoopbackPort(config.localAddress);
      state.ready = true;
      recordTigerBeetleTunnelReady();
    } catch (error) {
      if (tunnelState?.child === child) {
        tunnelState = null;
        recordTigerBeetleTunnelStopped("startup_failure", Date.now() - state.startedAt);
      }
      child.kill("SIGTERM");
      await rm(workspace, { recursive: true, force: true });
      const diagnostics = errorLines.join("").trim();
      throw new TigerBeetleConfigurationError(`TigerBeetle stunnel startup failed${diagnostics ? `: ${diagnostics}` : ""}`);
    }
  })();

  try {
    await startingTunnel;
  } catch (error) {
    lastTunnelError = error instanceof Error ? error.message : "TigerBeetle tunnel initialization failed";
    throw error;
  } finally {
    startingTunnel = null;
  }
}

export async function stopTigerBeetleTunnel(): Promise<void> {
  const state = tunnelState;
  tunnelState = null;
  if (!state) return;
  state.child.kill("SIGTERM");
  recordTigerBeetleTunnelStopped("graceful_stop", Date.now() - state.startedAt);
  await rm(state.workspace, { recursive: true, force: true });
}

/**
 * Creates a TigerBeetle client only after a caller explicitly requests a
 * read-only probe. The package uses native process inspection at import time,
 * which is unavailable in managed serverless containers; importing it here
 * keeps disabled integrations from preventing application startup.
 */
async function createTigerBeetleReadClient(): Promise<Client> {
  const config = getTigerBeetleConfiguration();
  const { createClient } = await import("tigerbeetle-node");
  return createClient({ cluster_id: config.clusterId, replica_addresses: [config.localAddress] });
}

/**
 * Performs only `lookupAccounts([0n])`: a non-mutating protocol operation used
 * to prove that the client reaches the configured cluster. It never creates an
 * account, transfer, or settlement instruction.
 */
export async function verifyTigerBeetleReadConnectivity(timeoutMs = 10_000): Promise<{ address: string; accountsReturned: number }> {
  let client: Client | undefined;
  let releaseClient: (() => void) | undefined;
  let timerHandle: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    const readClient = await createTigerBeetleReadClient();
    client = readClient;
    releaseClient = registerTigerBeetleReadClient();
    const timer = new Promise<never>((_, reject) => {
      timerHandle = setTimeout(() => {
        timedOut = true;
        reject(new TigerBeetleConfigurationError(`TigerBeetle read connectivity timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    const accounts = await observeDependencyOperation("tigerbeetle", "read_connectivity_check", () =>
      Promise.race([readClient.lookupAccounts([BigInt(0)]), timer])
    );
    recordTigerBeetleReadProbe("ok");
    return { address: getTigerBeetleConfiguration().localAddress, accountsReturned: accounts.length };
  } catch (error) {
    recordTigerBeetleReadProbe(timedOut ? "timeout" : "error");
    throw error;
  } finally {
    if (timerHandle) clearTimeout(timerHandle);
    try {
      client?.destroy();
    } finally {
      releaseClient?.();
    }
  }
}

export type TigerBeetleFinalityTransfer = {
  id: bigint;
  debitAccountId: bigint;
  creditAccountId: bigint;
  amountCents: bigint;
  ledger: number;
  code: number;
};

export type TigerBeetleFinalitySubmissionResult = {
  outcome: "created" | "exists_verified" | "permanent_rejection";
  resultCode: string;
};

function validateFinalityTransfer(input: TigerBeetleFinalityTransfer): Transfer {
  const maxU128 = (1n << 128n) - 1n;
  for (const [name, value] of Object.entries({ id: input.id, debitAccountId: input.debitAccountId, creditAccountId: input.creditAccountId, amountCents: input.amountCents })) {
    if (typeof value !== "bigint" || value <= 0n || value >= maxU128) {
      throw new TigerBeetleConfigurationError(`${name} must be a non-reserved positive unsigned 128-bit bigint`);
    }
  }
  if (input.debitAccountId === input.creditAccountId) throw new TigerBeetleConfigurationError("TigerBeetle finality debit and credit accounts must differ");
  if (!Number.isInteger(input.ledger) || input.ledger < 1 || input.ledger > 0xffffffff) throw new TigerBeetleConfigurationError("TigerBeetle finality ledger must be a positive uint32");
  if (!Number.isInteger(input.code) || input.code < 1 || input.code > 0xffff) throw new TigerBeetleConfigurationError("TigerBeetle finality code must be a positive uint16");
  return {
    id: input.id,
    debit_account_id: input.debitAccountId,
    credit_account_id: input.creditAccountId,
    amount: input.amountCents,
    pending_id: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    timeout: 0,
    ledger: input.ledger,
    code: input.code,
    flags: 0,
    timestamp: 0n,
  };
}

function sameFinalityTransfer(actual: Transfer, expected: Transfer): boolean {
  return actual.id === expected.id
    && actual.debit_account_id === expected.debit_account_id
    && actual.credit_account_id === expected.credit_account_id
    && actual.amount === expected.amount
    && actual.pending_id === expected.pending_id
    && actual.user_data_128 === expected.user_data_128
    && actual.user_data_64 === expected.user_data_64
    && actual.user_data_32 === expected.user_data_32
    && actual.timeout === expected.timeout
    && actual.ledger === expected.ledger
    && actual.code === expected.code
    && actual.flags === expected.flags;
}

/**
 * Submits one explicitly approved single-phase finality transfer through the
 * existing local mTLS tunnel. It is unavailable unless both finality execution
 * and the base TigerBeetle integration are explicitly enabled. An `exists`
 * outcome is accepted only after a lookup proves the immutable transfer fields
 * match the durable PostgreSQL intent exactly.
 */
export async function submitTigerBeetleFinalityTransfer(input: TigerBeetleFinalityTransfer, timeoutMs = 10_000): Promise<TigerBeetleFinalitySubmissionResult> {
  if (process.env.TIGERBEETLE_FINALITY_EXECUTION !== "true") {
    throw new TigerBeetleConfigurationError("TigerBeetle finality submission is disabled until an approved staging execution flag is explicitly set");
  }
  if (!readEnabledFlag()) throw new TigerBeetleConfigurationError("TIGERBEETLE_ENABLED must be true before finality submission");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) throw new TigerBeetleConfigurationError("TigerBeetle finality timeout must be between 1000 and 30000ms");
  const transfer = validateFinalityTransfer(input);
  await startTigerBeetleTunnel();
  let client: Client | undefined;
  let releaseClient: (() => void) | undefined;
  let timerHandle: NodeJS.Timeout | undefined;
  try {
    client = await createTigerBeetleReadClient();
    const { CreateTransferError } = await import("tigerbeetle-node");
    releaseClient = registerTigerBeetleReadClient();
    const timeout = new Promise<never>((_, reject) => {
      timerHandle = setTimeout(() => reject(new TigerBeetleConfigurationError(`TigerBeetle finality submission timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    const results = await observeDependencyOperation("tigerbeetle", "finality_transfer_submit", () => Promise.race([client!.createTransfers([transfer]), timeout]));
    if (results.length === 0) {
      recordTigerBeetleReadProbe("ok");
      return { outcome: "created", resultCode: "created" };
    }
    if (results.length === 1 && results[0]?.index === 0 && results[0]?.result === CreateTransferError.exists) {
      const existing = await observeDependencyOperation("tigerbeetle", "finality_transfer_verify_existing", () => client!.lookupTransfers([transfer.id]));
      if (existing.length !== 1 || !sameFinalityTransfer(existing[0]!, transfer)) {
        recordTigerBeetleReadProbe("error");
        return { outcome: "permanent_rejection", resultCode: "exists_payload_mismatch" };
      }
      recordTigerBeetleReadProbe("ok");
      return { outcome: "exists_verified", resultCode: "exists_verified" };
    }
    const first = results[0];
    recordTigerBeetleReadProbe("error");
    return { outcome: "permanent_rejection", resultCode: first ? `create_transfer_${CreateTransferError[first.result]}` : "unexpected_create_transfer_response" };
  } catch (error) {
    recordTigerBeetleReadProbe("error");
    throw error;
  } finally {
    if (timerHandle) clearTimeout(timerHandle);
    try { client?.destroy(); } finally { releaseClient?.(); }
  }
}

export function isTigerBeetleEnabled(): boolean {
  return readEnabledFlag();
}

export function getTigerBeetleReadiness(): {
  enabled: boolean;
  ready: boolean;
  state: "disabled" | "starting" | "ready" | "unavailable";
  reason?: string;
} {
  const enabled = readEnabledFlag();
  if (!enabled) return { enabled, ready: false, state: "disabled" };
  if (tunnelState) return { enabled, ready: true, state: "ready" };
  if (startingTunnel) return { enabled, ready: false, state: "starting" };
  return lastTunnelError
    ? { enabled, ready: false, state: "unavailable", reason: lastTunnelError }
    : { enabled, ready: false, state: "unavailable", reason: "TigerBeetle tunnel has not started" };
}
