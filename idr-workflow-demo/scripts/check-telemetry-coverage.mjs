import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const reportPath = resolve(root, process.env.TELEMETRY_COVERAGE_REPORT || "artifacts/telemetry-coverage.json");
mkdirSync(resolve(reportPath, ".."), { recursive: true });

const requiredFiles = [
  ["server/_core/telemetry-bootstrap.ts", "initializeTelemetry", "early Node SDK bootstrap"],
  ["server/_core/telemetry.ts", "getNodeAutoInstrumentations", "automatic HTTP/Kafka/Redis/Keycloak/Permify/OpenSearch/S3 instrumentation"],
  ["server/db.ts", "observeDependencyOperation(\"postgresql\"", "postgres-js connectivity boundary"],
  ["server/authz.ts", "observeDependencyOperation(\"permify\"", "Permify authorization boundary"],
  ["server/temporal.ts", "observeDependencyOperation(\"temporal\"", "Temporal SDK boundary"],
  ["server/tigerbeetle.ts", "observeDependencyOperation(\"tigerbeetle\"", "TigerBeetle native client boundary"],
  ["server/services/document-analysis.ts", "document-analysis", "document-analysis worker boundary"],
  ["server/_core/index.ts", "recordTelemetryOperation", "HTTP application outcome metrics"],
  ["server/services/operational-alerts.ts", "recordTelemetryOperation", "Alertmanager receipt metrics"],
  ["k8s/production/observability/observability-stack.yaml", "client_auth_type: require_and_verify_client_cert", "mTLS OTLP collector intake"],
  ["k8s/production/observability/observability-stack.yaml", "prometheusremotewrite", "Prometheus metrics export"],
  ["k8s/production/observability/observability-stack.yaml", "alertmanager", "open-source Alertmanager notification routing"],
  ["k8s/production/application/healthpoint-api.yaml", "OTEL_ENABLED", "application deployment telemetry enablement"],
];

const errors = [];
const coverage = requiredFiles.map(([path, token, boundary]) => {
  const absolute = resolve(root, path);
  const present = existsSync(absolute);
  const tokenFound = present && readFileSync(absolute, "utf8").includes(token);
  if (!tokenFound) errors.push(`${boundary}: expected ${path} to contain ${token}`);
  return { componentBoundary: boundary, path, token, status: tokenFound ? "implemented" : "missing" };
});

const externallyManaged = [
  "Apache APISIX", "open-appsec", "Fluvio", "Mojaloop", "Keycloak server", "Permify server",
  "Kafka brokers", "Redis server", "PostgreSQL server", "Temporal server/workers", "OpenSearch cluster",
  "TigerBeetle cluster", "Apache Sedona/Spark", "lakehouse runtime", "GeoLibre client", "Go services", "Rust services", "Python services",
].map(component => ({
  component,
  status: "onboarding_required",
  reason: "No active HealthPoint-owned deployment source or runnable service implementation exists in the authoritative checkout; collector discovery and language SDK templates do not constitute a deployed integration.",
}));

const report = {
  valid: errors.length === 0,
  generatedAt: new Date().toISOString(),
  privacyPolicy: "Tenant correlation is HMAC-derived for traces only; no tenant, user, patient, dispute, document, payment, request-body, SQL, or authorization-subject attribute may be exported. Metrics use bounded component/operation/status labels only.",
  activeCoverage: coverage,
  externalOrAbsentOnboarding: externallyManaged,
  errors,
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.valid) process.exitCode = 2;
