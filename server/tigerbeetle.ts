import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { mkdtemp, readFile, rm, writeFile, chmod, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "tigerbeetle-node";

const DEFAULT_CLUSTER_ID = "145851240909969808468846706535455565498";
const DEFAULT_LOCAL_ADDRESS = "127.0.0.1:16001";
const DEFAULT_REMOTE_ADDRESS = "173.66.76.192:32052";
const DEFAULT_TLS_SERVER_NAME = "tigerbeetle.newfire.app";
const DEFAULT_CA_PATH = "./infra/certs/tigerbeetle-ca.crt";
const DEFAULT_CLIENT_CERT_PATH = "./infra/certs/tigerbeetle-client.crt";

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
};

let tunnelState: TunnelState | null = null;
let startingTunnel: Promise<void> | null = null;

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

function configuredPath(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!value || value.includes("\0")) {
    throw new TigerBeetleConfigurationError(`${name} must be a valid file path`);
  }
  return value;
}

/**
 * Reads only the mutually authenticated, loopback-only connection settings.
 * The TigerBeetle client speaks clear TCP only to its local stunnel process;
 * direct remote connections are rejected so the mTLS control cannot be bypassed.
 */
export function getTigerBeetleConfiguration(): TigerBeetleConfiguration {
  const localAddress = process.env.TIGERBEETLE_ADDRESS?.trim() || DEFAULT_LOCAL_ADDRESS;
  const remoteAddress = process.env.TIGERBEETLE_TLS_REMOTE_ADDRESS?.trim() || DEFAULT_REMOTE_ADDRESS;
  const tlsServerName = process.env.TIGERBEETLE_TLS_SERVER_NAME?.trim() || DEFAULT_TLS_SERVER_NAME;
  const rawClusterId = process.env.TIGERBEETLE_CLUSTER_ID?.trim() || DEFAULT_CLUSTER_ID;
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
    caPath: configuredPath("TIGERBEETLE_CA_PATH", DEFAULT_CA_PATH),
    clientCertPath: configuredPath("TIGERBEETLE_CLIENT_CERT_PATH", DEFAULT_CLIENT_CERT_PATH),
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

    const child = spawn("stunnel", [configPath], { stdio: ["ignore", "ignore", "pipe"] });
    const errorLines: string[] = [];
    child.stderr?.on("data", chunk => {
      errorLines.push(String(chunk));
      if (errorLines.length > 20) errorLines.shift();
    });
    child.once("error", error => {
      console.error("[TigerBeetle] stunnel process could not start", error);
    });
    tunnelState = { child, workspace };

    try {
      await waitForLoopbackPort(config.localAddress);
    } catch (error) {
      child.kill("SIGTERM");
      tunnelState = null;
      await rm(workspace, { recursive: true, force: true });
      const diagnostics = errorLines.join("").trim();
      throw new TigerBeetleConfigurationError(`TigerBeetle stunnel startup failed${diagnostics ? `: ${diagnostics}` : ""}`);
    }
  })();

  try {
    await startingTunnel;
  } finally {
    startingTunnel = null;
  }
}

export async function stopTigerBeetleTunnel(): Promise<void> {
  const state = tunnelState;
  tunnelState = null;
  if (!state) return;
  state.child.kill("SIGTERM");
  await rm(state.workspace, { recursive: true, force: true });
}

/** Creates a TigerBeetle client that can only use the already verified loopback tunnel. */
export function createTigerBeetleReadClient(): Client {
  const config = getTigerBeetleConfiguration();
  return createClient({ cluster_id: config.clusterId, replica_addresses: [config.localAddress] });
}

/**
 * Performs only `lookupAccounts([0n])`: a non-mutating protocol operation used
 * to prove that the client reaches the configured cluster. It never creates an
 * account, transfer, or settlement instruction.
 */
export async function verifyTigerBeetleReadConnectivity(timeoutMs = 10_000): Promise<{ address: string; accountsReturned: number }> {
  const client = createTigerBeetleReadClient();
  const timer = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new TigerBeetleConfigurationError(`TigerBeetle read connectivity timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    const accounts = await Promise.race([client.lookupAccounts([BigInt(0)]), timer]);
    return { address: getTigerBeetleConfiguration().localAddress, accountsReturned: accounts.length };
  } finally {
    client.destroy();
  }
}

export function isTigerBeetleEnabled(): boolean {
  return readEnabledFlag();
}
