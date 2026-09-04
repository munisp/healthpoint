# This contract deliberately creates no Kubernetes or cloud resource. A separate,
# provider-owned staging root may consume its output only after protected review.
# Terraform must never execute the TigerBeetle partition drill.

variable "drill_log_access_gitops" {
  description = "Immutable GitOps handoff for the structured drill-log RBAC/NetworkPolicy bundle. Disabled unless explicitly approved in a protected staging pipeline."
  type = object({
    enabled                           = bool
    git_commit_sha                    = string
    manifest_bundle_sha256            = string
    source_validation_artifact_sha256 = string
    argocd_application_name           = string
    argocd_manual_sync_only           = bool
  })
  default = {
    enabled                           = false
    git_commit_sha                    = ""
    manifest_bundle_sha256            = ""
    source_validation_artifact_sha256 = ""
    argocd_application_name           = ""
    argocd_manual_sync_only           = true
  }

  validation {
    condition     = !var.drill_log_access_gitops.enabled || can(regex("^[a-f0-9]{40}$", var.drill_log_access_gitops.git_commit_sha))
    error_message = "Enabled GitOps handoff requires an immutable lower-case 40-character source commit SHA."
  }
  validation {
    condition     = !var.drill_log_access_gitops.enabled || can(regex("^[a-f0-9]{64}$", var.drill_log_access_gitops.manifest_bundle_sha256))
    error_message = "Enabled GitOps handoff requires a sha256 digest of the rendered manifest bundle."
  }
  validation {
    condition     = !var.drill_log_access_gitops.enabled || can(regex("^[a-f0-9]{64}$", var.drill_log_access_gitops.source_validation_artifact_sha256))
    error_message = "Enabled GitOps handoff requires a sha256 digest of the protected source-validation artifact."
  }
  validation {
    condition     = !var.drill_log_access_gitops.enabled || can(regex("^[a-z0-9]([-a-z0-9]*[a-z0-9])?$", var.drill_log_access_gitops.argocd_application_name))
    error_message = "Enabled GitOps handoff requires a DNS-safe Argo CD Application name."
  }
}

resource "terraform_data" "drill_log_access_gitops_guard" {
  input = merge(var.drill_log_access_gitops, {
    environment                         = var.environment
    recovery_automation_permitted       = false
    partition_drill_execution_permitted = false
  })

  lifecycle {
    precondition {
      condition     = !var.drill_log_access_gitops.enabled || var.environment == "staging"
      error_message = "Structured drill-log GitOps handoff is staging-only."
    }
    precondition {
      condition     = !var.drill_log_access_gitops.enabled || var.drill_log_access_gitops.argocd_manual_sync_only
      error_message = "The drill-log Argo CD Application must remain manual-sync-only; automatic synchronization is prohibited."
    }
  }
}

output "drill_log_access_gitops_contract" {
  description = "Non-secret immutable handoff to a separately approved, manual-sync-only Argo CD Application. It cannot authorize a partition drill."
  value = {
    enabled                           = var.drill_log_access_gitops.enabled
    git_commit_sha                    = var.drill_log_access_gitops.git_commit_sha
    manifest_bundle_sha256            = var.drill_log_access_gitops.manifest_bundle_sha256
    source_validation_artifact_sha256 = var.drill_log_access_gitops.source_validation_artifact_sha256
    argocd_application_name           = var.drill_log_access_gitops.argocd_application_name
    argocd_manual_sync_only           = var.drill_log_access_gitops.argocd_manual_sync_only
    partition_drill_execution_permitted = false
  }
}
