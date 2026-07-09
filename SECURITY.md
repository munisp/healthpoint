# Security & Production Deployment Guide

This document covers the security posture of the HealthPoint IDR platform and the steps required to harden it for production deployment.

---

## Environment Variables Required for Production

Copy `env.example` (in the project root) to `.env` and fill in all values. **Never commit `.env` to version control.**

| Variable | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JWT_SECRET` | Session cookie signing key (≥32 chars) | Yes |
| `KEYCLOAK_URL` | Keycloak OIDC server base URL | Yes |
| `KEYCLOAK_REALM` | Keycloak realm name | Yes |
| `KEYCLOAK_CLIENT_ID` | OAuth2 client ID | Yes |
| `KEYCLOAK_CLIENT_SECRET` | OAuth2 client secret | Yes |
| `KEYCLOAK_REDIRECT_URI` | Must match Keycloak config | Yes |
| `APP_URL` | Public URL of this app | Yes |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | Yes |
| `OLLAMA_BASE_URL` | Local Ollama URL (default: `http://localhost:11434`) | No |
| `OLLAMA_MODEL` | Default Ollama model (e.g. `gemma3`, `qwen2.5`) | No |
| `LLM_API_URL` | OpenAI-compatible fallback API URL | No |
| `LLM_API_KEY` | Fallback LLM API key | No |
| `S3_ENDPOINT_URL` | MinIO or S3-compatible endpoint | No |
| `AWS_ACCESS_KEY_ID` | S3 access key | No |
| `AWS_SECRET_ACCESS_KEY` | S3 secret key | No |
| `S3_BUCKET` | S3 bucket name | No |
| `REDIS_URL` | Redis URL for distributed rate limiting | No |
| `SMTP_HOST` | SMTP server for email notifications | No |
| `SCHEDULED_SECRET` | Auth token for scheduled task webhooks | No |

---

## Security Features Already Implemented

### Database
- PostgreSQL via Drizzle ORM (`postgres` driver)
- All queries use parameterized statements — no raw SQL injection risk
- Connection string format: `postgresql://user:password@host:5432/healthpoint`

### HTTP Security Headers (Helmet)
- `Content-Security-Policy` with strict `default-src: 'self'`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` restricting camera, microphone, geolocation

### Rate Limiting
- **Global:** 200 requests/minute per IP (production only)
- **Auth endpoints:** 20 requests/minute per IP
- **Brute-force slow-down:** Progressive delays after 5 auth requests (200ms, 400ms, ...)

### CORS
- Configurable via `ALLOWED_ORIGINS` environment variable
- Credentials supported with explicit origin allowlist
- All origins allowed in development

### Authentication (Keycloak OIDC)
- OAuth2 Authorization Code flow with PKCE
- Session cookies: `httpOnly`, `sameSite: lax`, `secure` in production
- Role-based access control: `admin` / `user` roles
- Protected tRPC procedures via `protectedProcedure`

### Input Validation
- All tRPC procedure inputs validated with Zod schemas
- HTTP Parameter Pollution (HPP) protection middleware
- Request body size limited to 50MB

### Observability
- **Request ID tracing:** Every request gets a `X-Request-ID` header for distributed tracing
- **Structured JSON logging:** Production logs are JSON-formatted for ingestion by Loki, Datadog, CloudWatch, etc.
- **Health check:** `GET /api/health` — returns DB connectivity, version, uptime
- **Liveness probe:** `GET /api/ready` — returns 200 immediately (for Kubernetes/Docker)
- **Response compression:** Gzip/Brotli via `compression` middleware

### Data Security
- Passwords are never stored (OAuth2 only)
- All database queries use Drizzle ORM parameterized queries (no raw SQL injection risk)
- File uploads stored in S3 (not local filesystem)

---

## Production Deployment Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Set a strong `JWT_SECRET` (≥32 random characters)
- [ ] Configure Keycloak realm and client
- [ ] Set `APP_URL` and `ALLOWED_ORIGINS` to your actual domain
- [ ] Configure `DATABASE_URL` with a production PostgreSQL database (format: `postgresql://user:pass@host:5432/dbname`)
- [ ] Enable HTTPS (TLS termination at load balancer or reverse proxy)
- [ ] Configure `SCHEDULED_SECRET` for webhook auth
- [ ] Set up S3/MinIO for file storage
- [ ] Configure SMTP for email notifications
- [ ] Set up Redis for distributed rate limiting (optional but recommended)
- [ ] Configure Ollama with your preferred model (`gemma3` or `qwen2.5`)
- [ ] Set up Umami analytics (optional)
- [ ] Configure log aggregation (Loki, Datadog, CloudWatch)
- [ ] Set up monitoring alerts on `/api/health` endpoint
- [ ] Review and tighten CSP directives for your specific domain

---

## Reporting Security Issues

Please report security vulnerabilities privately by emailing the maintainers. Do not open public GitHub issues for security vulnerabilities.
