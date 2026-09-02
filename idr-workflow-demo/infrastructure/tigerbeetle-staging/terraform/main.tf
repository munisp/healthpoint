terraform {
  required_version = ">= 1.6.0"
}

variable "environment" {
  type        = string
  description = "Must be staging. This module is intentionally not usable for production deployment."
  validation {
    condition     = var.environment == "staging"
    error_message = "This TigerBeetle recovery-validation topology is staging-only."
  }
}

variable "cluster_id" {
  type        = string
  description = "Globally unique, positive TigerBeetle 128-bit cluster identifier, supplied by controlled infrastructure inventory."
  sensitive   = true
  validation {
    condition     = can(parseint(var.cluster_id, 10)) && parseint(var.cluster_id, 10) > 0
    error_message = "cluster_id must be a positive decimal integer."
  }
}

variable "replicas" {
  type = list(object({
    replica_index   = number
    private_address = string
    fault_domain    = string
    machine_id      = string
    data_disk_id    = string
  }))
  description = "Six pre-provisioned dedicated replica nodes and data disks. Addresses must be static RFC1918 IPv4 addresses from the provider-specific infrastructure root."

  validation {
    condition     = length(var.replicas) == 6
    error_message = "TigerBeetle staging topology must provide exactly six replicas."
  }
  validation {
    condition     = length(distinct([for replica in var.replicas : replica.replica_index])) == 6 && sort([for replica in var.replicas : replica.replica_index]) == [0, 1, 2, 3, 4, 5]
    error_message = "replica_index must contain each ordinal 0 through 5 exactly once."
  }
  validation {
    condition     = length(distinct([for replica in var.replicas : replica.private_address])) == 6 && alltrue([for replica in var.replicas : can(regex("^(10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[0-1])\\.)", replica.private_address))])
    error_message = "Each replica needs a distinct static RFC1918 IPv4 address; public, loopback, link-local, and provider metadata addresses are prohibited."
  }
  validation {
    condition     = length(distinct([for replica in var.replicas : replica.fault_domain])) >= 3
    error_message = "Staging recovery validation requires at least three independent fault domains."
  }
  validation {
    condition     = length(distinct([for replica in var.replicas : replica.machine_id])) == 6 && alltrue([for replica in var.replicas : trimspace(replica.machine_id) != ""])
    error_message = "Each replica must use a distinct dedicated machine identifier."
  }
  validation {
    condition     = length(distinct([for replica in var.replicas : replica.data_disk_id])) == 6 && alltrue([for replica in var.replicas : trimspace(replica.data_disk_id) != ""])
    error_message = "Each replica must use a distinct persistent data disk identifier."
  }
}

variable "data_directory" {
  type        = string
  description = "Absolute mounted data directory on each dedicated replica machine, supplied by the provider-specific root."
  validation {
    condition     = can(regex("^/[A-Za-z0-9._/-]+$", var.data_directory)) && !can(regex("//|/\\.\\.(?:/|$)", var.data_directory))
    error_message = "data_directory must be a normalized absolute path."
  }
}

variable "tigerbeetle_image" {
  type        = string
  description = "Approved immutable TigerBeetle image reference in digest form."
  validation {
    condition     = can(regex("^.+@sha256:[a-f0-9]{64}$", var.tigerbeetle_image))
    error_message = "tigerbeetle_image must be immutable and use a sha256 digest."
  }
}

variable "server_tls_secret_reference" {
  type        = string
  description = "Opaque identifier for externally managed server-side mTLS material; secret data is not accepted by Terraform."
  sensitive   = true
  validation {
    condition     = trimspace(var.server_tls_secret_reference) != ""
    error_message = "server_tls_secret_reference must be an external secret-manager identifier."
  }
}

variable "client_tls_secret_reference" {
  type        = string
  description = "Opaque identifier for externally managed client-side mTLS material; secret data is not accepted by Terraform."
  sensitive   = true
  validation {
    condition     = trimspace(var.client_tls_secret_reference) != ""
    error_message = "client_tls_secret_reference must be an external secret-manager identifier."
  }
}

locals {
  ordered_replicas = [for index in range(6) : one([for replica in var.replicas : replica if replica.replica_index == index])]
  addresses        = [for replica in local.ordered_replicas : "${replica.private_address}:3000"]
  deployment_contract = {
    environment                  = var.environment
    cluster_id                   = var.cluster_id
    replica_count                = 6
    replica_addresses            = local.addresses
    tigerbeetle_image            = var.tigerbeetle_image
    data_directory               = var.data_directory
    server_tls_secret_reference  = var.server_tls_secret_reference
    client_tls_secret_reference  = var.client_tls_secret_reference
    recovery_automation_permitted = false
  }
}

resource "terraform_data" "staging_topology_guard" {
  input = local.deployment_contract

  lifecycle {
    precondition {
      condition     = alltrue([for replica in local.ordered_replicas : trimspace(replica.fault_domain) != ""])
      error_message = "Every replica must declare a fault domain."
    }
    precondition {
      condition     = var.server_tls_secret_reference != var.client_tls_secret_reference
      error_message = "Server and client mTLS materials must use distinct external secret references."
    }
  }
}

output "deployment_contract" {
  description = "Non-secret topology contract for a provider-specific VM/storage provisioning root and a separately approved configuration-management deployment job."
  value = {
    environment       = local.deployment_contract.environment
    replica_count     = local.deployment_contract.replica_count
    replica_addresses = local.deployment_contract.replica_addresses
    tigerbeetle_image = local.deployment_contract.tigerbeetle_image
    data_directory    = local.deployment_contract.data_directory
    fault_domains     = [for replica in local.ordered_replicas : replica.fault_domain]
    machine_ids       = [for replica in local.ordered_replicas : replica.machine_id]
    data_disk_ids     = [for replica in local.ordered_replicas : replica.data_disk_id]
    recovery_automation_permitted = false
  }
}

output "tigerbeetle_format_arguments" {
  description = "Per-replica initial-format arguments. Run only once on a verified empty disk under an approved initialization change; never use this output for recovery."
  value = [for replica in local.ordered_replicas : {
    replica_index = replica.replica_index
    arguments = [
      "format",
      "--cluster=${var.cluster_id}",
      "--replica-count=6",
      "--replica=${replica.replica_index}",
      "${var.data_directory}/${var.cluster_id}_${replica.replica_index}.tigerbeetle",
    ]
  }]
}

output "tigerbeetle_start_arguments" {
  description = "Per-replica command arguments for an approved configuration-management job; recovery and format actions are deliberately excluded."
  value = [for replica in local.ordered_replicas : {
    replica_index = replica.replica_index
    arguments = [
      "start",
      "--addresses=${join(",", local.addresses)}",
      "${var.data_directory}/${var.cluster_id}_${replica.replica_index}.tigerbeetle",
    ]
  }]
}
