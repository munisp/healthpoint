import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { operationalAlertEvents } from "../../drizzle/schema";
import { recordTelemetryOperation } from "../_core/telemetry";

const SAFE_VALUE = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_ALERTS_PER_DELIVERY = 100;
const MAX_BODY_BYTES = 256 * 1024;

type AlertStatus = "firing" | "resolved";
type AlertSeverity = "info" | "warning" | "critical";

type AlertmanagerAlert = {
  status?: unknown;
  labels?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  fingerprint?: unknown;
};

type AlertmanagerDelivery = {
  alerts?: unknown;
};

export type SanitizedOperationalAlert = {
  fingerprint: string;
  alertName: string;
  service: string;
  severity: AlertSeverity;
  status: AlertStatus;
  startsAt: Date;
  endsAt: Date | null;
};

function safeValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !SAFE_VALUE.test(value)) {
    throw new Error(`${field} must match ${SAFE_VALUE}`);
  }
  return value;
}

function validDate(value: unknown, field: string, allowEmpty = false): Date | null {
  if (allowEmpty && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string") throw new Error(`${field} must be an RFC 3339 timestamp`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be an RFC 3339 timestamp`);
  return parsed;
}

function optionalFingerprint(value: unknown, fallback: string): string {
  if (typeof value === "string" && SAFE_VALUE.test(value)) return value;
  return fallback;
}

/**
 * Validates only the bounded labels declared by HealthPoint alert rules. The
 * Alertmanager payload's annotations, generator URL, receiver, and external
 * labels are deliberately not retained because they may carry sensitive data.
 */
export function sanitizeAlertmanagerDelivery(raw: unknown): SanitizedOperationalAlert[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Alertmanager delivery must be a JSON object");
  }
  const delivery = raw as AlertmanagerDelivery;
  if (!Array.isArray(delivery.alerts) || delivery.alerts.length === 0) {
    throw new Error("Alertmanager delivery must contain at least one alert");
  }
  if (delivery.alerts.length > MAX_ALERTS_PER_DELIVERY) {
    throw new Error(`Alertmanager delivery exceeds ${MAX_ALERTS_PER_DELIVERY} alerts`);
  }

  return delivery.alerts.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`alerts[${index}] must be an object`);
    }
    const alert = candidate as AlertmanagerAlert;
    if (!alert.labels || typeof alert.labels !== "object" || Array.isArray(alert.labels)) {
      throw new Error(`alerts[${index}].labels must be an object`);
    }
    const labels = alert.labels as Record<string, unknown>;
    const status = safeValue(alert.status, `alerts[${index}].status`);
    if (status !== "firing" && status !== "resolved") {
      throw new Error(`alerts[${index}].status must be firing or resolved`);
    }
    const severity = safeValue(labels.severity, `alerts[${index}].labels.severity`);
    if (severity !== "info" && severity !== "warning" && severity !== "critical") {
      throw new Error(`alerts[${index}].labels.severity is not allow-listed`);
    }
    const alertName = safeValue(labels.alertname, `alerts[${index}].labels.alertname`);
    const service = safeValue(labels.service, `alerts[${index}].labels.service`);
    const startsAt = validDate(alert.startsAt, `alerts[${index}].startsAt`) as Date;
    const endsAt = validDate(alert.endsAt, `alerts[${index}].endsAt`, true);
    const fallback = crypto
      .createHash("sha256")
      .update(`${alertName}:${service}:${severity}:${status}:${startsAt.toISOString()}`)
      .digest("hex");
    return {
      fingerprint: optionalFingerprint(alert.fingerprint, fallback),
      alertName,
      service,
      severity,
      status,
      startsAt,
      endsAt,
    };
  });
}

export function verifyAlertmanagerBearer(
  authorizationHeader: string | undefined,
  expectedToken: string | undefined
): boolean {
  if (!expectedToken || expectedToken.length < 32 || !authorizationHeader?.startsWith("Bearer ")) {
    return false;
  }
  const provided = authorizationHeader.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(expectedToken, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  return (
    providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

export async function recordAlertmanagerDelivery(rawBody: unknown): Promise<number> {
  if (!Buffer.isBuffer(rawBody)) {
    throw new Error("Alertmanager body must be an unmodified binary request payload");
  }
  if (rawBody.length === 0 || rawBody.length > MAX_BODY_BYTES) {
    throw new Error(`Alertmanager body must contain at most ${MAX_BODY_BYTES} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new Error("Alertmanager body must be valid JSON");
  }
  const alerts = sanitizeAlertmanagerDelivery(parsed);
  const payloadSha256 = crypto.createHash("sha256").update(rawBody).digest("hex");
  const db = await getDb();
  if (!db) throw new Error("PostgreSQL is unavailable for operational alert audit");

  try {
    await db
      .insert(operationalAlertEvents)
      .values(
        alerts.map(alert => ({
          id: randomUUID(),
          alertFingerprint: alert.fingerprint,
          alertName: alert.alertName,
          service: alert.service,
          severity: alert.severity,
          status: alert.status,
          startsAt: alert.startsAt,
          endsAt: alert.endsAt,
          payloadSha256,
        }))
      )
      .onConflictDoNothing();
    for (const alert of alerts) {
      recordTelemetryOperation({
        component: "application",
        operation: "alertmanager.delivery",
        status: "ok",
      });
      void alert;
    }
    return alerts.length;
  } catch (error) {
    recordTelemetryOperation({
      component: "application",
      operation: "alertmanager.delivery",
      status: "error",
    });
    throw error;
  }
}
