# SpiderByte hosted control-plane Worker

This package is the Cloudflare runtime boundary for the commercial edition. It
contains real adapters for Hyperdrive-backed PostgreSQL, R2 artifact storage,
Queues, Workflows, structured observability, and a SQLite-backed Durable Object
event coordinator.

The Worker deliberately reports capability state instead of claiming hosted
execution or authenticated WebSocket access before the Modal adapter, SecretRef
resolution, and broader resource authorization paths are wired into the
runtime. The local Open Core does not import this package.

## Local setup

1. Create a Hyperdrive configuration for the managed PostgreSQL database.
2. Create the R2 bucket and the two Queues named in `wrangler.jsonc`.
3. Replace the placeholder Hyperdrive ID and development resource names in
   `wrangler.jsonc`, or use environment-specific Wrangler configuration.
4. Run `pnpm types` from this package after changing bindings.
5. Configure secrets with `wrangler secret put`; do not put credential values in
   `wrangler.jsonc` or command arguments.
6. Run `pnpm deploy` only after the capability endpoint reports the expected
   bindings and the database migrations have been reviewed.

`GET /healthz` and `GET /api/v1/commercial/capabilities` are diagnostic routes.
They are not authorization gates and must not be used as proof that a tenant
request is allowed. `GET /api/v1/commercial/session` is the first authenticated
commercial route: it verifies the Clerk bearer token, synchronizes the complete
organization membership snapshot into SpiderByte records, and returns only the
authorized principal and organizations. It never returns the bearer token.

## Provider adapters

`OpenRouterLlmAdapter` sends the provider-neutral LLM contract to the configured
Cloudflare AI Gateway OpenRouter endpoint. It keeps the bearer credential at the
adapter boundary, sends a bounded queryable metadata header plus the complete
SpiderByte context in the trace payload, supports streaming/fallback/retry, and
returns provider usage as reconciliation input. It does not make provider cost
authoritative.

`ModalExecutionAdapter` requires a durable execution-reference store and a
`ModalExecutionTransport`. `ModalWebFunctionTransport` is the HTTPS transport
for deployed Modal Web Functions protected by `Modal-Key` and `Modal-Secret`.
The Modal-side function must return a provider job ID and a recognized lifecycle
state; malformed or terminal submit responses are rejected. The adapter never
turns a request into a successful execution locally.

Both adapters are exported for composition by the commercial application layer;
the Worker does not expose either provider directly to browsers or clients.

## Required secrets and variables

Non-secret variables:

- `SPIDERBYTE_ENVIRONMENT`: deployment label.
- `SPIDERBYTE_COMMERCIAL_ACCOUNT_ID`: stable `acct_...` SpiderByte account ID
  representing this hosted Clerk instance. It must remain stable across deploys.
- `OPENROUTER_AI_GATEWAY_ENDPOINT`: HTTPS endpoint ending in `/openrouter` or
  the complete `/chat/completions` path.
- `SPIDERBYTE_PUBLIC_ORIGIN`: HTTPS public origin used when issuing artifact
  download signatures.

Secrets, configured with `wrangler secret put`:

- `CLERK_SECRET_KEY`: Clerk server credential. Token verification and resource
  authorization are server-only. The authenticated commercial session route
  also reads organization membership through this credential.
- `CLERK_JWT_KEY`: optional Clerk JWT verification key when the deployment uses
  a custom JWT key.
- `CLERK_AUTHORIZED_PARTIES`: optional comma-separated authorized parties for
  Clerk token verification.
- `OPENROUTER_API_KEY`: server-only OpenRouter credential when AI Gateway is
  configured to forward it.
- `ARTIFACT_DOWNLOAD_SIGNING_SECRET`: at least 32 random characters. Rotate it
  by overlapping signer verification during a planned migration.
- `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`: only for the Modal Web Function
  transport; never expose these to a browser, CLI, SDK, or MCP client.

The Worker reports billing, entitlement, SecretRef, and Modal dispatch as
unavailable until their application-level reconciliation, authorization, and
durable reference-store wiring are installed. A present Clerk secret alone does
not grant billing or entitlement access.

## Deployment checklist

1. Create the PostgreSQL database and Hyperdrive configuration; review the
   commercial migrations before the first production deploy.
2. Create the R2 bucket and both queues, then replace the development names and
   placeholder Hyperdrive ID in `wrangler.jsonc` per environment.
3. Configure the variables and secrets above with Wrangler secret storage.
4. Deploy and call `/api/v1/commercial/capabilities` from an authenticated
   operator channel. Confirm that database, artifact storage, event bus,
   workflow, and observability are available; treat all other statuses as
   explicit release gates.
5. Exercise a content-addressed artifact upload/download, duplicate event
   delivery, queue retry, workflow retry, and Durable Object reconnect before
   enabling tenant traffic.
6. Exercise `/api/v1/commercial/session` with a real Clerk bearer token and
   verify tenant counts, membership removal, idempotent replay, and audit
   writes before enabling broader tenant traffic.
7. Enable the remaining authenticated API gateway only after rate limits,
   budgets, entitlements, and all resource authorization paths are connected
   to the same application services used by local/API clients.
