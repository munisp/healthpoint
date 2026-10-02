/**
 * server/idr/gateway/connector.ts — Phase 20-B: CMS IDR Gateway connector.
 *
 * HONESTY (verbatim from the Phase 20 design §5.3):
 *  "The CMS IDR Gateway connector transport (OAuth2 client-credentials +
 *  JSON REST intake) is an ASSUMPTION-based scaffold: as of 2026-09 CMS has
 *  published Gateway account-registration guidance but NO public
 *  machine-to-machine API specification, intake schema, sandbox endpoint, or
 *  bulk-submission path. The adapter targets the statutory initiation
 *  elements of 45 CFR 149.510(b) and must be revised against CMS technical
 *  specifications when published."
 *  "Connector logic is unit-testable against mocked Gateway responses
 *  (MOCK-VERIFIED, labeled as such). Live transmission is UNVERIFIABLE
 *  without CMS-issued credentials and a published Gateway API; this phase
 *  never transmits and never fabricates a submission id."
 *  "Without CMS_GATEWAY_* credentials the connector reports DISABLED and the
 *  platform continues the assisted-manual portal-package flow; no behavior
 *  changes for existing users."
 *
 * Rules enforced here:
 *  - NEVER called from buildSubmissionPackage; assisted-manual remains the
 *    default path.
 *  - No fake ids: the disabled stub throws and never returns a synthetic
 *    gatewaySubmissionId.
 *  - clientSecret is env-only and NEVER logged or serialized.
 */

export type GatewayConnectorMode = "disabled" | "configured";

export interface GatewayConfig {
  /** CMS_GATEWAY_BASE_URL */
  baseUrl: string;
  /** CMS_GATEWAY_CLIENT_ID */
  clientId: string;
  /** CMS_GATEWAY_CLIENT_SECRET — env-only, never logged. */
  clientSecret: string;
  /** CMS_GATEWAY_ORG_REGISTRATION_ID — Gateway org account id. */
  orgRegistrationId: string;
}

const REQUIRED_ENV = [
  "CMS_GATEWAY_BASE_URL",
  "CMS_GATEWAY_CLIENT_ID",
  "CMS_GATEWAY_CLIENT_SECRET",
  "CMS_GATEWAY_ORG_REGISTRATION_ID",
] as const;

/**
 * Returns null (with a logged reason naming ONLY the missing env var names)
 * when any required env is absent — FAIL-CLOSED.
 */
export function resolveGatewayConfig(
  env: Record<string, string | undefined> = process.env,
): GatewayConfig | null {
  const missing = REQUIRED_ENV.filter(k => !env[k]?.trim());
  if (missing.length > 0) {
    console.log(
      `[cms-idr-gateway] DISABLED — missing env: ${missing.join(", ")}; ` +
      "assisted-manual portal-package flow remains the submission path"
    );
    return null;
  }
  return {
    baseUrl: env.CMS_GATEWAY_BASE_URL!.trim().replace(/\/+$/, ""),
    clientId: env.CMS_GATEWAY_CLIENT_ID!.trim(),
    clientSecret: env.CMS_GATEWAY_CLIENT_SECRET!,
    orgRegistrationId: env.CMS_GATEWAY_ORG_REGISTRATION_ID!.trim(),
  };
}

export interface GatewaySubmissionRequest {
  disputeId: string;
  orgRegistrationId: string;
  /** Mapped from SubmissionPackage.portalFields (see ./mapping.ts). */
  initiation: Record<string, string>;
  supportingDocumentRefs: string[];
}

export interface GatewaySubmissionResult {
  gatewaySubmissionId: string;
  status: "received" | "accepted" | "rejected";
  statusDetail?: string;
  submittedAt: string;
}

export type GatewayStatus =
  | "submitted"
  | "under_review"
  | "eligible"
  | "ineligible"
  | "assigned_to_idre"
  | "determination_issued"
  | "unknown";

/** Transport/auth failures (network, 5xx, token acquisition). */
export class GatewayUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayUnavailableError";
  }
}

/** Well-formed rejection returned by the Gateway intake. */
export class GatewayRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayRejectedError";
  }
}

export interface GatewayConnector {
  readonly mode: GatewayConnectorMode;
  submitInitiation(req: GatewaySubmissionRequest): Promise<GatewaySubmissionResult>;
  pollStatus(
    gatewaySubmissionId: string,
  ): Promise<{ status: GatewayStatus; detail?: string; polledAt: string }>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Real client. Transport: OAuth2 client-credentials token endpoint +
 * JSON REST intake — ASSUMPTION pending CMS technical specs (see header).
 * All HTTP goes through `fetchImpl` (injectable for MOCK-VERIFIED tests).
 */
export function createGatewayConnector(
  config: GatewayConfig,
  fetchImpl: FetchLike = fetch,
): GatewayConnector {
  let cachedToken: { token: string; expiresAtMs: number } | null = null;

  async function getToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAtMs > Date.now() + 30_000) {
      return cachedToken.token;
    }
    let res: Response;
    try {
      res = await fetchImpl(`${config.baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }).toString(),
      });
    } catch (err) {
      throw new GatewayUnavailableError(
        `CMS IDR Gateway token endpoint unreachable: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    if (!res.ok) {
      throw new GatewayUnavailableError(`CMS IDR Gateway token endpoint returned HTTP ${res.status}`);
    }
    const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!body?.access_token) {
      throw new GatewayUnavailableError("CMS IDR Gateway token endpoint returned no access_token");
    }
    cachedToken = {
      token: body.access_token,
      expiresAtMs: Date.now() + (typeof body.expires_in === "number" ? body.expires_in : 300) * 1000,
    };
    return cachedToken.token;
  }

  async function authedJson(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const token = await getToken();
    let res: Response;
    try {
      res = await fetchImpl(`${config.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (err) {
      throw new GatewayUnavailableError(
        `CMS IDR Gateway unreachable: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 401 || res.status === 403 || res.status >= 500) {
      throw new GatewayUnavailableError(`CMS IDR Gateway returned HTTP ${res.status}`);
    }
    if (res.status === 422 || res.status === 400) {
      throw new GatewayRejectedError(
        `CMS IDR Gateway rejected the submission (HTTP ${res.status}): ${String(body.detail ?? body.message ?? "no detail")}`
      );
    }
    if (!res.ok) {
      throw new GatewayUnavailableError(`CMS IDR Gateway returned HTTP ${res.status}`);
    }
    return body;
  }

  const KNOWN_STATUSES: readonly string[] = [
    "submitted", "under_review", "eligible", "ineligible", "assigned_to_idre", "determination_issued",
  ];

  return {
    mode: "configured",

    async submitInitiation(req) {
      const body = await authedJson("/v1/idr/initiations", {
        method: "POST",
        body: JSON.stringify({
          disputeId: req.disputeId,
          orgRegistrationId: req.orgRegistrationId,
          initiation: req.initiation,
          supportingDocumentRefs: req.supportingDocumentRefs,
        }),
      });
      const id = typeof body.gatewaySubmissionId === "string" ? body.gatewaySubmissionId : null;
      const status = typeof body.status === "string" ? body.status : "received";
      if (!id) {
        // Never fabricate an id — a submission without an id is a transport anomaly.
        throw new GatewayUnavailableError("CMS IDR Gateway response carried no gatewaySubmissionId");
      }
      if (status === "rejected") {
        throw new GatewayRejectedError(String(body.statusDetail ?? "Gateway rejected the submission"));
      }
      return {
        gatewaySubmissionId: id,
        status: status === "accepted" ? "accepted" : "received",
        statusDetail: typeof body.statusDetail === "string" ? body.statusDetail : undefined,
        submittedAt: new Date().toISOString(),
      };
    },

    async pollStatus(gatewaySubmissionId) {
      const body = await authedJson(`/v1/idr/initiations/${encodeURIComponent(gatewaySubmissionId)}/status`, {
        method: "GET",
      });
      const raw = typeof body.status === "string" ? body.status : "unknown";
      return {
        status: (KNOWN_STATUSES.includes(raw) ? raw : "unknown") as GatewayStatus,
        detail: typeof body.detail === "string" ? body.detail : undefined,
        polledAt: new Date().toISOString(),
      };
    },
  };
}

/**
 * Fail-closed stub returned when CMS_GATEWAY_* env is absent. Every method
 * throws GatewayUnavailableError; mode is "disabled". It NEVER returns a
 * synthetic gatewaySubmissionId.
 */
export function getGatewayConnector(
  env: Record<string, string | undefined> = process.env,
): GatewayConnector {
  const config = resolveGatewayConfig(env);
  if (!config) {
    return {
      mode: "disabled",
      submitInitiation: () =>
        Promise.reject(
          new GatewayUnavailableError(
            "CMS IDR Gateway connector is DISABLED — credentials not configured; " +
            "use assisted-manual portal package flow"
          )
        ),
      pollStatus: () =>
        Promise.reject(
          new GatewayUnavailableError(
            "CMS IDR Gateway connector is DISABLED — credentials not configured; " +
            "use assisted-manual portal package flow"
          )
        ),
    };
  }
  return createGatewayConnector(config);
}
