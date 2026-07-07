# ── HealthPoint Service Policies ─────────────────────────────────────────────
# Applied via: vault policy write <name> <file>

# ── Base policy: all services can read their own secrets ──────────────────────
# Applied to every service AppRole

path "secret/data/healthpoint/common/*" {
  capabilities = ["read"]
}

path "secret/data/healthpoint/{{identity.entity.aliases.auth_approle_*.metadata.service_name}}/*" {
  capabilities = ["read"]
}

# ── Database dynamic credentials ─────────────────────────────────────────────
path "database/creds/healthpoint-readonly" {
  capabilities = ["read"]
}

path "database/creds/healthpoint-readwrite" {
  capabilities = ["read"]
}

# ── PKI — services can issue their own TLS certs ──────────────────────────────
path "pki/issue/healthpoint-services" {
  capabilities = ["create", "update"]
}

# ── Transit — encryption as a service ────────────────────────────────────────
path "transit/encrypt/healthpoint-data" {
  capabilities = ["create", "update"]
}

path "transit/decrypt/healthpoint-data" {
  capabilities = ["create", "update"]
}

path "transit/rewrap/healthpoint-data" {
  capabilities = ["create", "update"]
}

# ── Lease renewal ─────────────────────────────────────────────────────────────
path "sys/leases/renew" {
  capabilities = ["create", "update"]
}

path "auth/token/renew-self" {
  capabilities = ["update"]
}
