# Provider/FSP Sandbox Evidence Intake

## Submission Boundary

Supply provider-issued materials only through the project secret interface or a secure file upload. Never paste private keys, bearer tokens, or settlement reports into source files, chat messages, or Git history. The existing TigerBeetle client certificate and key are infrastructure credentials and must **not** be reused for a settlement provider.

| Required material | Secure destination | Acceptance check performed by HealthPoint |
|---|---|---|
| Provider CA bundle | Upload as `settlement-provider-ca.crt` | Valid PEM chain and hostname trust validation. |
| Client certificate | Upload as `settlement-provider-client.crt` | Certificate validity period, issuer chain, and provider identity review. |
| Client private key | Secret `SETTLEMENT_MTLS_CLIENT_KEY_PEM` | Stored as a deployment secret only; paired with the client certificate without being written to disk in source control. |
| Callback ingress certificate fingerprint | Secret `SETTLEMENT_MTLS_CLIENT_FINGERPRINTS` | SHA-256 fingerprint comparison at callback ingress. |
| Signed callback/reconciliation API credentials | Provider-specific secret names after interface review | Authenticated, non-destructive sandbox handshake and report retrieval. |
| Sandbox endpoint and protocol document | Upload provider integration guide or provide HTTPS URL | Hostname, TLS, method, payload schema, and signature requirements verification. |
| Reconciliation-report sample | Upload a redacted signed sample plus schema/contract | Schema validation, idempotency, amount/currency matching, exception routing, and immutable evidence checks. |
| Written sandbox acceptance evidence | Upload provider/FSP test attestation or acceptance report | Stored as release evidence; required before changing any settlement execution posture. |

## Minimum Acceptance Scenarios

HealthPoint will validate the provider sandbox with disabled payment execution. The provider must acknowledge successful mutual-TLS authentication, authenticated callback ingestion, duplicate callback idempotency, valid reconciliation-report processing, amount-mismatch exception handling, reversal evidence, and retrieval of an independent signed report. The provider must also confirm that no test transfer can reach a live rail.

> The hermetic simulator exercises the application protocol but is not a substitute for this evidence. Only provider-issued sandbox materials and a successful bilateral acceptance record can close the real-provider release gate.

## Next Action

After you upload the certificate, CA bundle, redacted reconciliation report, and provider interface documentation, provide the provider sandbox hostname and indicate which uploaded files are public certificates versus private keys. I will configure the non-secret endpoint settings, request only the required private-key and token secrets, then execute the non-destructive acceptance suite with `PAYMENT_EXECUTION_MODE=disabled`.

When the provider material is configured, validate its certificate chain and key pairing before attempting network interoperability:

```sh
PAYMENT_EXECUTION_MODE=disabled \
SETTLEMENT_PROVIDER_SANDBOX_URL=https://sandbox.provider.example \
SETTLEMENT_MTLS_CLIENT_CERT_PATH=/secure/provider-client.crt \
SETTLEMENT_MTLS_CA_PATH=/secure/provider-ca.crt \
SETTLEMENT_MTLS_CLIENT_KEY_PEM="$SETTLEMENT_MTLS_CLIENT_KEY_PEM" \
./scripts/validate-provider-sandbox-evidence.sh
```
