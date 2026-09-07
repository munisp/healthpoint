# DEPRECATED — openappsec WAF hop (ADR-003, one-WAF decision)

**Deprecated 2026-09-05; removed from docker-compose.yml 2026-09-07.**

These files configured the OpenAppsec NGINX ML-WAF hop that sat between the
edge and the API gateway:

    Internet -> Caddy (TLS + Coraza WAF) -> openappsec:80 -> APISIX -> App

## Why it was removed

- **Single WAF at the edge.** The platform standardised on ONE web
  application firewall: the Coraza (OWASP CRS) module embedded in Caddy at
  the edge. Running two WAFs in series doubled latency and the
  false-positive surface, and split rule-tuning / block-page handling across
  two systems, making incident response ambiguous about which layer blocked
  a request.
- **The hop was decorative.** A bypass defect in this configuration (the
  nginx.conf `appsec` module was not engaged on all proxied locations, and
  health-check / direct-APISIX fallbacks bypassed it) meant openappsec only
  ever inspected a subset of traffic. It cost latency and operational
  surface without providing its claimed protection.
- **Unpinned image.** The service ran `openappsec/nginx:latest`, a mutable
  tag that was a release-blocking audit finding.

See ADR-003 in `infra/ARCHITECTURE-DECISIONS.md` for the full decision
record.

## Reversal path

The compose service definition and the Caddyfile `reverse_proxy
openappsec:80` block were deleted, not commented out. If an ML-based WAF is
genuinely required again, restore both from git history
(pre-2026-09-05/2026-09-07), pin the image to a registry-verified digest,
and fix the bypass defect (enforce the appsec module on every location and
fail closed when the agent is unhealthy) before re-enabling.

## Contents (kept for reference only — nothing consumes them)

- `nginx.conf`          — NGINX + openappsec agent configuration
- `local_policy.yaml`   — openappsec practice/policy definition
- `openapi.yaml`        — API schema fed to the ML-WAF for schema validation
