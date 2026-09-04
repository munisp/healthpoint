import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve("infrastructure/tigerbeetle-staging/k8s/structured-drill-log-rbac-networkpolicy.yaml.template");
const text = readFileSync(path, "utf8");
const findings = [];
function required(value) { if (!text.includes(value)) findings.push(`missing required contract: ${value}`); }
function forbidden(pattern, reason) { if (pattern.test(text)) findings.push(reason); }

for (const value of [
  "name: tigerbeetle-drill-log-emitter",
  "name: tigerbeetle-drill-forensic-snapshot-reader",
  "name: tigerbeetle-drill-forensic-query-client",
  "automountServiceAccountToken: false",
  "resources: [\"pods/log\"]",
  "resources: [\"networkpolicies\"]",
  "verbs: [\"get\", \"list\", \"watch\"]",
  "port: 4317",
  "port: 4318",
  "port: 53",
  "cidr: ${OPENSEARCH_PRIVATE_CIDR}",
  "app.kubernetes.io/name: otel-collector",
]) required(value);

forbidden(/\b(create|update|patch|delete|deletecollection)\b/, "RBAC must not grant Kubernetes write verbs");
forbidden(/resources:\s*\[[^\]]*(?:"secrets"|"configmaps"|"pods\/exec"|"pods\/portforward")/m, "RBAC must not read secrets/configmaps or use exec/portforward");
forbidden(/cidr:\s*0\.0\.0\.0\/0/, "NetworkPolicy must not permit public egress");
forbidden(/name:\s*tigerbeetle-drill-log-emitter[\s\S]{0,500}?automountServiceAccountToken:\s*true/m, "log emitter must not receive a Kubernetes API token");
forbidden(/name:\s*tigerbeetle-drill-forensic-query-client[\s\S]{0,500}?automountServiceAccountToken:\s*true/m, "query client must not receive a Kubernetes API token");

if (findings.length) {
  console.error("TIGERBEETLE_DRILL_LOG_ACCESS_CONTRACT_INVALID");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(2);
}
console.log("TIGERBEETLE_DRILL_LOG_ACCESS_CONTRACT_VALID: emitters/query clients have no Kubernetes API token, snapshot collection is read-only, and OTLP/query egress is private and bounded");
