import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve("infrastructure/tigerbeetle-staging/terraform/main.tf");
const text = readFileSync(path, "utf8");
const required = [
  [/required_version\s*=\s*">= 1\.6\.0"/, "minimum Terraform version"],
  [/var\.environment\s*==\s*"staging"/, "staging-only environment gate"],
  [/length\(var\.replicas\)\s*==\s*6/, "six replica requirement"],
  [/\[0, 1, 2, 3, 4, 5\]/, "fixed replica ordinals"],
  [/distinct\(\[for replica in var\.replicas : replica\.private_address\]\)\)\s*==\s*6/, "unique private addresses"],
  [/RFC1918/, "private addressing contract"],
  [/distinct\(\[for replica in var\.replicas : replica\.fault_domain\]\)\)\s*>=\s*3/, "minimum three fault domains"],
  [/distinct\(\[for replica in var\.replicas : replica\.machine_id\]\)\)\s*==\s*6/, "unique machine identities"],
  [/distinct\(\[for replica in var\.replicas : replica\.data_disk_id\]\)\)\s*==\s*6/, "unique persistent disks"],
 [/^\s*variable "tigerbeetle_image"/m, "immutable image input"],
  [/@sha256:\[a-f0-9\]\{64\}/, "digest-pinned image validation"],
  [/server_tls_secret_reference/, "server external secret reference"],
  [/client_tls_secret_reference/, "client external secret reference"],
  [/server_tls_secret_reference != var\.client_tls_secret_reference/, "separate client/server TLS secrets"],
  [/recovery_automation_permitted\s*=\s*false/, "recovery automation prohibition"],
  [/"format"/, "one-time format output"],
  [/"start"/, "start output"],
];
const errors = required.filter(([pattern]) => !pattern.test(text)).map(([, name]) => `Missing required topology control: ${name}`);
const forbidden = [
  [/provider\s+"/, "provider configuration belongs in a separate reviewed operations root"],
  [/resource\s+"(?:aws|google|azurerm|kubernetes|helm)_/, "provider resource belongs in a separate reviewed operations root"],
  [/\brecover\b/i, "permanent-loss recovery automation is prohibited"],
  [/0\.0\.0\.0\/0/, "public ingress is prohibited"],
];
for (const [pattern, message] of forbidden) if (pattern.test(text)) errors.push(`Forbidden topology content: ${message}`);
if (errors.length) {
  console.error(JSON.stringify({ valid: false, errors }, null, 2));
  process.exit(2);
}
console.log(JSON.stringify({ valid: true, contract: "tigerbeetle-staging-six-replica-topology", controls: required.length }, null, 2));
