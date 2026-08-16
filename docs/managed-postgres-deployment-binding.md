# Managed PostgreSQL Deployment Binding

## Required Production Runtime Variables

Configure the following values in the deployment environment that starts the HealthPoint container. Do **not** commit the password or place it in a source-controlled `.env` file.

| Variable | Required value |
|---|---|
| `DATABASE_URL` | `postgresql://oracle_admin:${POSTGRES_PASSWORD}@173.66.76.192:5432/postgres?sslmode=verify-ca&sslrootcert=/app/infra/certs/postgres-ca.crt` |
| `NODE_ENV` | `production` |
| `PAYMENT_EXECUTION_MODE` | `disabled` until regulated-provider acceptance is independently evidenced |
| `INTERNAL_SERVICE_TOKEN` | A unique high-entropy deployment secret |
| `JWT_SECRET` | A unique high-entropy secret of at least 32 characters |
| `EMR_CREDENTIALS_ENCRYPTION_KEY` | A 64-character hexadecimal AES-256 key |

`/app/infra/certs/postgres-ca.crt` is present in the production image because the Dockerfile copies the repository `infra` directory into `/app/infra`.

## Deployment Binding Procedure

Set `POSTGRES_PASSWORD` using the secret manager or database-binding UI, then set the rendered `DATABASE_URL` value in the **deployment environment** for the production service. The platform preview's built-in database variable cannot be overridden with the project secret interface; this binding must be applied in the hosting/deployment configuration that launches the production container.

After the deployment is restarted, verify the application health endpoint reports PostgreSQL connectivity and the process logs no `DATABASE_URL is not a PostgreSQL connection string` message. Independently, use the release validator with the same production environment before any release decision.

```sh
curl --fail --silent --show-error https://YOUR_DEPLOYED_DOMAIN/api/health
```

The health response must show a successful database check. If it reports a non-PostgreSQL binding or database failure, do not proceed with the daily schedule or any settlement-related operation.
