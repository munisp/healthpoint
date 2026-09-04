terraform {
  required_version = ">= 1.6.0"
}

variable "environment" {
  type        = string
  description = "The contract is staging-only."
  validation {
    condition     = var.environment == "staging"
    error_message = "This external-gates module is staging-only."
  }
}

variable "components" {
  description = "Provider-root inventory. Values are non-secret; secret values must never enter Terraform state."
  type = map(object({
    enabled                  = bool
    image_digest             = string
    namespace                = string
    private_endpoint         = string
    secret_manager_references = map(string)
    deployment_mode          = string
  }))

  validation {
    condition     = setequals(toset(keys(var.components)), toset(["mojaloop", "permify", "keycloak", "fluvio", "openappsec"]))
    error_message = "components must contain exactly mojaloop, permify, keycloak, fluvio, and openappsec."
  }
  validation {
    condition = alltrue([for name, component in var.components :
      !component.enabled || can(regex("^.+@sha256:[a-f0-9]{64}$", component.image_digest))
    ])
    error_message = "Every enabled component must use an immutable sha256 image digest."
  }
  validation {
    condition = alltrue([for name, component in var.components :
      !component.enabled || (trimspace(component.namespace) != "" && can(regex("^https://(?:(?:10\\.|192\\.168\\.|172\\.(?:1[6-9]|2[0-9]|3[0-1])\\.)|(?:[a-z0-9-]+\\.)+[a-z0-9-]+\\.svc\\.cluster\\.local(?::[0-9]+)?(?:/|$)|(?:[a-z0-9-]+\\.)+[a-z0-9-]+\\.internal(?::[0-9]+)?(?:/|$))", lower(trimspace(component.private_endpoint))))
    ])
    error_message = "Every enabled component requires a namespace and an HTTPS endpoint limited to RFC1918 space, Kubernetes service DNS, or an approved .internal DNS name."
  }
}

variable "mojaloop_datastore_engine" {
  type        = string
  description = "Provider-approved datastore engine for the isolated Mojaloop deployment. HealthPoint business records remain PostgreSQL and no Mojaloop datastore is assumed by this contract."
  default     = "unselected"
  validation {
    condition     = !contains(["postgres", "postgresql"], lower(var.mojaloop_datastore_engine))
    error_message = "Mojaloop must not be declared PostgreSQL-backed; select its provider-approved isolated datastore engine."
  }
}

variable "fluvio_application_integration_approved" {
  type        = bool
  description = "Set only after a real HealthPoint Fluvio producer/consumer is implemented, security-reviewed, and testable."
  default     = false
}

locals {
  required_secret_keys = {
    mojaloop   = toset(["tls_ca", "client_certificate", "client_key", "jws_signing_key"])
    permify    = toset(["tls_ca", "runtime_bearer_token"])
    keycloak   = toset(["database_credentials", "admin_bootstrap", "oidc_client_secret", "tls_certificate"])
    fluvio     = toset(["tls_ca", "client_certificate", "client_key"])
    openappsec = toset(["management_token", "tls_certificate"])
  }
}

resource "terraform_data" "external_gate_guard" {
  input = var.components

  lifecycle {
    precondition {
      condition = alltrue([for name, required_keys in local.required_secret_keys :
        !var.components[name].enabled || setequals(toset(keys(var.components[name].secret_manager_references)), required_keys)
      ])
      error_message = "Enabled components need exactly the documented external secret-manager reference keys; do not provide secret values to Terraform."
    }
    precondition {
      condition     = !var.components["fluvio"].enabled || var.fluvio_application_integration_approved
      error_message = "Fluvio cannot be enabled until HealthPoint has a real, reviewed producer/consumer integration and staging verification."
    }
    precondition {
      condition     = !var.components["mojaloop"].enabled || (lower(var.mojaloop_datastore_engine) != "unselected" && !contains(["postgres", "postgresql"], lower(var.mojaloop_datastore_engine)))
      error_message = "Mojaloop requires a separately approved, isolated non-PostgreSQL datastore selection before it can be enabled."
    }
  }
}

output "external_gate_provisioning_contract" {
  description = "Non-secret inventory for a provider-specific infrastructure root. No infrastructure is created by this cloud-agnostic contract."
  value = {
    environment = var.environment
    components  = { for name, component in var.components : name => {
      enabled          = component.enabled
      namespace        = component.namespace
      private_endpoint = component.private_endpoint
      image_digest     = component.image_digest
      secret_keys      = sort(keys(component.secret_manager_references))
    }}
    mojaloop_datastore_engine = var.mojaloop_datastore_engine
    fluvio_application_integration_approved = var.fluvio_application_integration_approved
  }
}
