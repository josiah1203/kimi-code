# Self-hosted and optional hosted deployment boundary

This document is a deployment boundary, not a claim that a hosted product
exists in this checkout. The accepted commercial direction is a seat-based
edition deployed on customer-owned infrastructure. SpiderByte-operated hosted
compute and model-usage billing are optional future products.

## What the local package can do

`@spiderbyte/kap-server` can run the local REST/WebSocket server and the
curated Streamable HTTP MCP endpoint when `SPIDERBYTE_MCP_PROFILE=curated` is
set. It uses local persistence, local bearer auth,
local workspaces, local policy, local budgets, local usage, and configured
local/customer-managed execution targets.

## What a customer-owned commercial deployment must add

A customer-owned commercial deployment must provide and independently test:

- account creation/sign-in and secure token lifecycle;
- tenant and workspace membership isolation;
- plan, entitlement, billing, metering, and budget enforcement;
- customer-controlled secret storage and provider adapters;
- customer-owned CPU/GPU workers, provider selection, job queues,
  cancellation, timeout, retention, and artifact deletion;
- organization administration, SSO/SAML/SCIM, enterprise audit retention,
  private networking, residency, compliance, support, and SLA controls;
- production TLS, rate limits, tracing, health/readiness, alerting, backup,
  recovery, and deployment attestations.

The remote plugin connection is therefore a customer-controlled SpiderByte
daemon, not a SpiderByte-hosted compute service. The daemon must expose only
the authenticated `/mcp` route through the customer’s HTTPS reverse proxy or
private tunnel. Public plugin OAuth is still unavailable in Open Core; a
customer must add protected-resource metadata, an authorization server,
validated scopes, token expiry/revocation, and PKCE before using a public
ChatGPT connection.

The current capability report marks operations that need a commercial control
plane `hosted-required`, `provider-unavailable`, or `enterprise-only`. Otis
never falls back to an anonymous shared account or pretends that a hosted
provider is available.

An optional SpiderByte-operated hosted service would additionally require:

- a production identity and tenancy authority;
- managed infrastructure, data retention, provider proxy, and billing;
- the deployment, security, privacy, support, and operational evidence listed
  in the commercial release-readiness matrix.

## Safe development pattern

Use a loopback SpiderByte server and an HTTPS tunnel for a short-lived
developer-mode test. The tunnel must forward `/mcp` only, preserve the bearer
boundary, and be removed after testing. Do not bind an unauthenticated server
to a public interface.

## Production readiness gate

Do not label the plugin publicly hosted or release-ready until the hosted
services, credential configuration, privacy/support metadata, security review,
dependency/SBOM/license review, and deployment rehearsal have evidence.
