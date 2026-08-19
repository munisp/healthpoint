# Temporal SDK Integration Reference

This release uses the official Temporal TypeScript client guidance for application-side gRPC connections and workflow invocation.

| Topic | Applied control | Source |
|---|---|---|
| Secure client connection | Reusable `Connection` with TLS CA material, certificate-name override, and bearer-token metadata via the client API-key option | [Temporal TypeScript `ConnectionOptions`](https://typescript.temporal.io/api/interfaces/client.ConnectionOptions) |
| Durable workflow dispatch | Workflow starts include a business-scoped workflow ID and a task queue; execution is only scheduled when an approved worker polls that queue | [Temporal TypeScript client guide](https://docs.temporal.io/develop/typescript/client/temporal-client) |
| Idempotent workflow messaging | Clients may start, query, or signal workflows; workflow start is not equivalent to workflow progress without a matching worker | [Temporal workflow message-passing guide](https://docs.temporal.io/develop/typescript/workflows/message-passing) |

HealthPoint keeps dispatch explicitly disabled by default and fails closed in production until the Temporal operator provides exact endpoint identity, namespace, task queue, workflow type, and bearer credential details.
