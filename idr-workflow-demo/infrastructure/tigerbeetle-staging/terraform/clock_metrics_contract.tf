# Cloud-agnostic validation contract only. This module does not configure host
# clocks and does not deploy Kubernetes objects. A provider-owned root must
# provision the nodes, manage chronyd through immutable node configuration, and
# apply the separately rendered/read-reviewed Kubernetes manifests.

variable "clock_metrics" {
  description = "Staging-only immutable handoff for Chrony/Node Exporter role-scoped metrics and the read-only clock monitor."
  type = object({
    enabled                                = bool
    chrony_time_source_configuration_sha256 = string
    chrony_exporter_image                  = string
    node_exporter_image                    = string
    healthpoint_app_image                  = string
    timing_roles                           = set(string)
    chrony_socket_path                     = string
    chrony_socket_group_id                 = number
    rendered_exporters_sha256              = string
    rendered_clock_monitor_sha256          = string
    rendered_clock_rules_sha256            = string
    source_validation_artifact_sha256      = string
    manual_argocd_sync_only                = bool
  })
  default = {
    enabled                                = false
    chrony_time_source_configuration_sha256 = ""
    chrony_exporter_image                  = ""
    node_exporter_image                    = ""
    healthpoint_app_image                  = ""
    timing_roles                           = []
    chrony_socket_path                     = ""
    chrony_socket_group_id                 = 0
    rendered_exporters_sha256              = ""
    rendered_clock_monitor_sha256          = ""
    rendered_clock_rules_sha256            = ""
    source_validation_artifact_sha256      = ""
    manual_argocd_sync_only                = true
  }

  validation {
    condition     = !var.clock_metrics.enabled || can(regex("^[a-f0-9]{64}$", var.clock_metrics.chrony_time_source_configuration_sha256))
    error_message = "Enabled clock metrics require the SHA-256 of the approved immutable host Chrony configuration."
  }
  validation {
    condition     = !var.clock_metrics.enabled || alltrue([for image in [var.clock_metrics.chrony_exporter_image, var.clock_metrics.node_exporter_image, var.clock_metrics.healthpoint_app_image] : can(regex("^.+@sha256:[a-f0-9]{64}$", image))])
    error_message = "Enabled clock metrics require immutable digest-pinned Chrony exporter, Node Exporter, and HealthPoint monitor images."
  }
  validation {
    condition     = !var.clock_metrics.enabled || var.clock_metrics.timing_roles == toset(["application", "cni", "otel_collector", "prometheus"])
    error_message = "Enabled clock metrics require exactly the application, cni, otel_collector, and prometheus timing roles."
  }
  validation {
    condition     = !var.clock_metrics.enabled || can(regex("^/run/[a-z0-9._/-]+$", var.clock_metrics.chrony_socket_path))
    error_message = "Enabled clock metrics require an explicit absolute Chrony runtime socket path under /run; do not use a network chronyd command port."
  }
  validation {
    condition     = !var.clock_metrics.enabled || var.clock_metrics.chrony_socket_group_id > 0 && var.clock_metrics.chrony_socket_group_id < 65536
    error_message = "Enabled clock metrics require the approved non-root numeric Chrony socket group ID."
  }
  validation {
    condition     = !var.clock_metrics.enabled || alltrue([for digest in [var.clock_metrics.rendered_exporters_sha256, var.clock_metrics.rendered_clock_monitor_sha256, var.clock_metrics.rendered_clock_rules_sha256, var.clock_metrics.source_validation_artifact_sha256] : can(regex("^[a-f0-9]{64}$", digest))])
    error_message = "Enabled clock metrics require SHA-256 digests of all rendered manifests and the source validation artifact."
  }
}

resource "terraform_data" "clock_metrics_staging_guard" {
  input = merge(var.clock_metrics, {
    environment                         = var.environment
    time_adjustment_automation_permitted = false
    partition_drill_execution_permitted = false
  })

  lifecycle {
    precondition {
      condition     = !var.clock_metrics.enabled || var.environment == "staging"
      error_message = "Clock metrics handoff is staging-only."
    }
    precondition {
      condition     = !var.clock_metrics.enabled || var.clock_metrics.manual_argocd_sync_only
      error_message = "Clock metrics handoff requires manual Argo CD synchronization; automatic sync is prohibited."
    }
  }
}

output "clock_metrics_handoff" {
  description = "Non-secret checked handoff for provider-managed node time baseline and manually synchronized exporter, monitor, and alert-rule manifests."
  value = {
    enabled                                = var.clock_metrics.enabled
    timing_roles                           = var.clock_metrics.timing_roles
    chrony_socket_path                     = var.clock_metrics.chrony_socket_path
    chrony_time_source_configuration_sha256 = var.clock_metrics.chrony_time_source_configuration_sha256
    manual_argocd_sync_only                = var.clock_metrics.manual_argocd_sync_only
    time_adjustment_automation_permitted   = false
    partition_drill_execution_permitted    = false
  }
}
