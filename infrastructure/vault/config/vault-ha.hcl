# HashiCorp Vault — Production HA Raft Configuration
# 3-node cluster with integrated Raft storage, TLS everywhere
# Deploy with: vault-0, vault-1, vault-2 nodes

ui = true
log_level = "info"
log_format = "json"

# ── Cluster networking ────────────────────────────────────────────────────────
cluster_name = "healthpoint-vault"

# ── Listener: HTTPS only ──────────────────────────────────────────────────────
listener "tcp" {
  address       = "0.0.0.0:8200"
  tls_cert_file = "/vault/tls/vault.crt"
  tls_key_file  = "/vault/tls/vault.key"
  tls_min_version = "tls12"
  tls_cipher_suites = "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384"

  # Telemetry endpoint — Prometheus scrapes this
  telemetry {
    unauthenticated_metrics_access = false
  }
}

# ── Integrated Raft storage ───────────────────────────────────────────────────
storage "raft" {
  path    = "/vault/data"
  node_id = "VAULT_NODE_ID"  # Replaced by entrypoint: vault-0, vault-1, vault-2

  # Raft performance tuning
  performance_multiplier = 1

  # Retry join — all three nodes discover each other
  retry_join {
    leader_api_addr     = "https://vault-0.vault-internal:8200"
    leader_ca_cert_file = "/vault/tls/ca.crt"
  }
  retry_join {
    leader_api_addr     = "https://vault-1.vault-internal:8200"
    leader_ca_cert_file = "/vault/tls/ca.crt"
  }
  retry_join {
    leader_api_addr     = "https://vault-2.vault-internal:8200"
    leader_ca_cert_file = "/vault/tls/ca.crt"
  }
}

# ── API address ───────────────────────────────────────────────────────────────
api_addr     = "https://VAULT_NODE_ADDR:8200"
cluster_addr = "https://VAULT_NODE_ADDR:8201"

# ── Seal: Auto-unseal via AWS KMS (swap for GCP/Azure as needed) ──────────────
# For air-gapped deployments, comment this out and use Shamir seal with 5-of-3
seal "awskms" {
  region     = "us-east-1"
  kms_key_id = "alias/healthpoint-vault-unseal"
  # Credentials injected via IAM role — no static keys
}

# ── Telemetry ─────────────────────────────────────────────────────────────────
telemetry {
  prometheus_retention_time = "30s"
  disable_hostname          = false
}

# ── Audit device — write to stdout so container log aggregation picks it up ───
# Configured programmatically after init; see vault_setup.sh
