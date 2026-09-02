import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const source = join(root, "infrastructure/external-gates-staging/k8s");
const fixture = mkdtempSync(join(tmpdir(), "healthpoint-external-gates-policy-"));
const digest = "registry.staging.internal/component@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const tokens = {
  PERMIFY_NAMESPACE: "healthpoint-staging-authz",
  KEYCLOAK_NAMESPACE: "healthpoint-staging-identity",
  MOJALOOP_NAMESPACE: "healthpoint-staging-payments",
  FLUVIO_NAMESPACE: "healthpoint-staging-streaming",
  OPENAPPSEC_NAMESPACE: "healthpoint-staging-security",
  PERMIFY_SECRET_PREFIX: "staging/permify",
  KEYCLOAK_SECRET_PREFIX: "staging/keycloak",
  MOJALOOP_SECRET_PREFIX: "staging/mojaloop",
  FLUVIO_SECRET_PREFIX: "staging/fluvio",
  OPENAPPSEC_SECRET_PREFIX: "staging/openappsec",
  PERMIFY_IMAGE_DIGEST: digest,
  KEYCLOAK_IMAGE_DIGEST: digest,
  CURL_IMAGE_DIGEST: digest,
  FLUVIO_CLI_IMAGE_DIGEST: digest,
  HEALTHPOINT_APP_IMAGE_DIGEST: digest,
  STATSD_EXPORTER_IMAGE_DIGEST: digest,
  OTLP_HTTPS_ENDPOINT: "https://otel.healthpoint-staging-observability.svc.cluster.local:4318",
  KEYCLOAK_POSTGRES_SERVICE: "keycloak-postgres.healthpoint-staging-data.svc.cluster.local",
  KEYCLOAK_PUBLIC_HOSTNAME: "keycloak.healthpoint-staging.internal",
  KEYCLOAK_MAX_QUEUED_REQUESTS: "100",
  KEYCLOAK_REALM: "healthpoint",
  MOJALOOP_CHART_VERSION: "16.0.0",
  MOJALOOP_CHART_PROVENANCE_SHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  MOJALOOP_IMAGE_PROVENANCE_SHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  MOJALOOP_PARTICIPANT_CIDR: "10.72.0.0/16",
  MOJALOOP_PARTICIPANT_HEALTH_HOST: "mojaloop-participant.healthpoint-staging-payments.svc.cluster.local",
  FLUVIO_CHART_REFERENCE: "oci://registry.staging.internal/fluvio/chart",
  FLUVIO_CHART_PROVENANCE_SHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  FLUVIO_IMAGE_PROVENANCE_SHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  FLUVIO_CLUSTER_CIDR: "10.73.0.0/16",
  FLUVIO_CLUSTER_PORT: "9003",
  FLUVIO_HEALTH_TOPIC: "healthpoint-staging-health",
  FLUVIO_CLUSTER_ENDPOINT: "https://fluvio.healthpoint-staging-streaming.svc.cluster.local:9003",
  OPENAPPSEC_APISIX_CHART_REFERENCE: "oci://registry.staging.internal/openappsec/apisix",
  OPENAPPSEC_CHART_PROVENANCE_SHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  OPENAPPSEC_IMAGE_PROVENANCE_SHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  OPENAPPSEC_APISIX_INGRESS_CLASS: "openappsec-staging",
  OPENAPPSEC_MANAGEMENT_MODE: "standalone",
  OPENAPPSEC_TRACE_CONTEXT_POLICY_CONFIGMAP: "trace-context-defense",
  OPENAPPSEC_MANAGEMENT_CIDR: "10.74.0.0/16",
  OPENAPPSEC_STAGING_HOST: "openappsec.healthpoint-staging-security.svc.cluster.local",
  OPENAPPSEC_SAFE_READ_PATH: "/healthz",
  RELEASE_ID: "policy-test",
};

function render(value) {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => tokens[key] ?? `UNRESOLVED_${key}`);
}

try {
  cpSync(source, fixture, { recursive: true });
  for (const component of ["mojaloop", "permify", "keycloak", "fluvio", "openappsec"]) {
    const directory = join(fixture, component);
    const file = readFileSync(join(directory, component === "permify" || component === "keycloak" ? "staging.yaml.template" : "staging-release.yaml.template"), "utf8");
    const destination = join(directory, "rendered.yaml");
    writeFileSync(destination, render(file));
    rmSync(join(directory, component === "permify" || component === "keycloak" ? "staging.yaml.template" : "staging-release.yaml.template"));
  }
  const run = (suffix = "") => spawnSync("node", ["scripts/validate-external-gate-templates.mjs", "--rendered"], {
    cwd: root,
    env: {
      ...process.env,
      EXTERNAL_GATES_RENDERED_DIR: fixture,
      EXTERNAL_GATES_POLICY_REPORT: join(fixture, `report${suffix}.json`),
    },
    encoding: "utf8",
  });
  const valid = run("-valid");
  if (valid.status !== 0) throw new Error(`expected valid rendered template fixture: ${valid.stdout}${valid.stderr}`);

  const permify = join(fixture, "permify", "rendered.yaml");
  writeFileSync(permify, readFileSync(permify, "utf8").replace(digest, "registry.staging.internal/component:latest"));
  const invalidImage = run("-mutable-image");
  if (invalidImage.status === 0 || !invalidImage.stdout.includes("mutable-image")) throw new Error("mutable image was not rejected");

  writeFileSync(permify, readFileSync(permify, "utf8").replace("registry.staging.internal/component:latest", digest).replace("https://permify.healthpoint-staging-authz.svc.cluster.local:3476/healthz", "https://public.example/healthz"));
  const invalidEndpoint = run("-public-endpoint");
  if (invalidEndpoint.status === 0 || !invalidEndpoint.stdout.includes("non-private-runtime-endpoint")) throw new Error("public endpoint was not rejected");

  const fluvio = join(fixture, "fluvio", "rendered.yaml");
  writeFileSync(fluvio, readFileSync(fluvio, "utf8").replace('enabled: "false"', 'enabled: "true"'));
  const invalidFluvio = run("-fluvio");
  if (invalidFluvio.status === 0 || !invalidFluvio.stdout.includes("fluvio-premature-activation")) throw new Error("premature Fluvio activation was not rejected");

  const mojaloop = join(fixture, "mojaloop", "rendered.yaml");
  writeFileSync(mojaloop, `${readFileSync(mojaloop, "utf8")}\nmojaloop_database_engine: postgresql\nclient_token: leaked-value\n`);
  const invalidMojaloop = run("-mojaloop-isolation");
  if (invalidMojaloop.status === 0 || !invalidMojaloop.stdout.includes("mojaloop-postgresql-claim")) throw new Error("Mojaloop PostgreSQL assertion was not rejected");
  if (!invalidMojaloop.stdout.includes("inline-secret")) throw new Error("inline credential was not rejected");

  process.stdout.write("external-gate-template-policy-tests: passed\n");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
