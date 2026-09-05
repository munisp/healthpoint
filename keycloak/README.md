# Keycloak realm import

`docker-compose.yml` mounts this directory at
`/opt/keycloak/data/import` inside the `keycloak` container and starts it with
`start-dev --import-realm`, so `realm-export.json` is imported automatically on
first boot.

## Realm

- Realm name: **`healthpoint`** — must stay in sync with anything that builds
  OIDC URLs (`/realms/healthpoint/...`): the compose healthcheck, the Caddy
  `forward_auth` directives in `infra/caddy/Caddyfile`, and the app.
- Clients: `healthpoint-app` (public, Authorization Code + PKCE S256, callback
  `http://localhost:3000/api/auth/callback/*` and the Caddy domain),
  `healthpoint-frontend`, `healthpoint-backend` (confidential),
  `apisix-gateway` (bearer-only).

## Required environment variables

Set these before `docker compose up` (e.g. in `.env`); the realm export keeps
secrets as `${VAR}` templates:

- `KC_ADMIN_USER` / `KC_ADMIN_PASSWORD` — bootstrap admin (defaults: `admin`/`admin`, dev only).
- `KEYCLOAK_BACKEND_CLIENT_SECRET` — secret for the `healthpoint-backend` client.
- `KEYCLOAK_APISIX_CLIENT_SECRET` — secret for the `apisix-gateway` client.
- `ADMIN_INITIAL_PASSWORD`, `PROVIDER_TEST_PASSWORD`, `PLAN_TEST_PASSWORD`,
  `IDR_ENTITY_TEST_PASSWORD` — initial (temporary) passwords for the seeded
  demo users.

If any of the `${...}` variables are unset at import time, Keycloak imports the
literal placeholder string; always provide real values outside local dev.
