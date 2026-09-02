import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const contractPath = resolve("infrastructure/tigerbeetle-staging/terraform/clock_metrics_contract.tf");
const examplePath = resolve("infrastructure/tigerbeetle-staging/terraform/terraform.tfvars.example");
const contract = readFileSync(contractPath, "utf8");
const example = readFileSync(examplePath, "utf8");
const findings = [];
const requireText = (source, value, label) => { if (!source.includes(value)) findings.push(`missing ${label}: ${value}`); };
const forbid = (source, pattern, message) => { if (pattern.test(source)) findings.push(message); };

for (const value of [
  'variable "clock_metrics"',
  "enabled                                = bool",
  "chrony_time_source_configuration_sha256",
  "chrony_exporter_image",
  "node_exporter_image",
  "healthpoint_app_image",
  "timing_roles",
  "chrony_socket_path",
  "chrony_socket_group_id",
  "rendered_exporters_sha256",
  "rendered_clock_monitor_sha256",
  "rendered_clock_rules_sha256",
  "source_validation_artifact_sha256",
  "manual_argocd_sync_only",
  "timing_roles == toset([\"application\", \"cni\", \"otel_collector\", \"prometheus\"])",
  "@sha256:[a-f0-9]{64}",
  "environment == \"staging\"",
  "time_adjustment_automation_permitted = false",
  "partition_drill_execution_permitted = false",
  'resource "terraform_data" "clock_metrics_staging_guard"',
]) requireText(contract, value, "clock metrics Terraform control");
forbid(contract, /resource\s+"(?:kubernetes|helm|aws|azurerm|google|oci|digitalocean|openstack|vsphere|linode)_/i, "clock metrics Terraform contract must not create provider, Kubernetes, or Helm resources");
forbid(contract, /(?:ntp|nts|time).*?(?:key|token|secret|password)\s*=/i, "clock metrics Terraform contract must not accept time-service credentials");
const contractWithoutComments = contract.replace(/^\s*#.*$/gm, "");
forbid(contractWithoutComments, /(?:^|\n)\s*(?:local-exec|remote-exec|provisioner|kubectl\b|argocd\s+app\s+sync|terraform\s+apply|run-tigerbeetle-(?:partition|quorum)-recovery-drill)/im, "clock metrics Terraform contract must not invoke deployment or drill commands");
requireText(example, "clock_metrics = {", "clock metrics example block");
requireText(example, "enabled                                = false", "disabled-by-default example");
forbid(example, /(?:@sha256:[a-f0-9]{64}|(?:key|token|password|certificate)\s*=\s*\"(?!\"\s*$).+)/i, "clock metrics example must not contain deployable credentials or real image digests");

if (findings.length) {
  console.error("TIGERBEETLE_CLOCK_METRICS_TERRAFORM_CONTRACT_INVALID");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(2);
}
console.log("TIGERBEETLE_CLOCK_METRICS_TERRAFORM_CONTRACT_VALID: staging-only immutable handoff, exact timing roles, no credentials, manual sync, no provider resources, and no time/drill automation");
