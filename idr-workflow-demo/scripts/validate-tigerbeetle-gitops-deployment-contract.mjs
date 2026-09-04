import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
  if (!name?.startsWith("--") || !value || value.startsWith("--")) {
    console.error("Usage: node scripts/validate-tigerbeetle-gitops-deployment-contract.mjs [--terraform <path>] [--argo <path>]");
    process.exit(2);
  }
  argumentsByName.set(name, value);
}
const terraformPath = resolve(argumentsByName.get("--terraform") ?? "infrastructure/tigerbeetle-staging/terraform/gitops_log_access_contract.tf");
const argoPath = resolve(argumentsByName.get("--argo") ?? "infrastructure/tigerbeetle-staging/argocd/tigerbeetle-drill-log-access.application.yaml.template");
const terraform = readFileSync(terraformPath, "utf8");
const argo = readFileSync(argoPath, "utf8");
const findings = [];
const requireText = (source, value, label) => { if (!source.includes(value)) findings.push(`missing ${label}: ${value}`); };
const forbid = (source, pattern, label) => { if (pattern.test(source)) findings.push(label); };

for (const value of [
  "recovery_automation_permitted       = false",
  "partition_drill_execution_permitted = false",
  "argocd_manual_sync_only",
  "git_commit_sha",
  "manifest_bundle_sha256",
  "source_validation_artifact_sha256",
]) requireText(terraform, value, "Terraform GitOps guard");
forbid(terraform, /resource\s+"(?:kubernetes_|helm_)/, "Terraform contract must not create Kubernetes/Helm resources");
forbid(terraform, /run-tigerbeetle-(?:partition|quorum)-recovery-drill/, "Terraform contract must not invoke a drill script");

for (const value of [
  "apiVersion: argoproj.io/v1alpha1",
  "kind: Application",
  "targetRevision: ${GIT_COMMIT_SHA}",
  "healthpoint.io/source-commit-sha: ${GIT_COMMIT_SHA}",
  "healthpoint.io/manifest-bundle-sha256: ${MANIFEST_BUNDLE_SHA256}",
  "healthpoint.io/source-validation-artifact-sha256: ${SOURCE_VALIDATION_ARTIFACT_SHA256}",
  "CreateNamespace=false",
  "ServerSideApply=true",
  "Validate=true",
]) requireText(argo, value, "Argo CD manual-sync contract");
forbid(argo, /^\s*automated:/m, "Argo CD automated sync is prohibited for the drill-log access bundle");
forbid(argo, /targetRevision:\s*(?:HEAD|main|master|develop|\*)\s*$/m, "Argo CD targetRevision must be an immutable commit SHA placeholder, not a branch/tag");
forbid(argo, /^\s*prune:\s*true\s*$/m, "Argo CD automated pruning is prohibited for this manually reviewed access bundle");
forbid(argo, /^\s*-\s*Prune=true\s*$/m, "Argo CD pruning must not be enabled for this manually reviewed access bundle");
forbid(argo, /^(?:kind:\s*CronJob|\s*(?:command|args):.*run-tigerbeetle-(?:partition|quorum)-recovery-drill|\s*PAYMENT_EXECUTION_MODE:\s*enabled)\s*$/m, "Argo CD bundle must not declare a drill runner or financial enablement");

if (findings.length) {
  console.error("TIGERBEETLE_GITOPS_DEPLOYMENT_CONTRACT_INVALID");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(2);
}
console.log("TIGERBEETLE_GITOPS_DEPLOYMENT_CONTRACT_VALID: immutable revision handoff, manual Argo sync, no Terraform Kubernetes resources, and no drill execution path");
