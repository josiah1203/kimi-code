# Hosted deployment boundary

This document is a deployment boundary, not a claim that the hosted product
exists in this checkout.

## What the local package can do

`@spiderbyte/kap-server` can run the local REST/WebSocket server and the
Streamable HTTP MCP endpoint. It uses local persistence, local bearer auth,
local workspaces, local policy, local budgets, local usage, and configured
local/customer-managed execution targets.

## What a production hosted service must add

A commercial deployment must provide and independently test:

- account creation/sign-in and secure token lifecycle;
- tenant and workspace membership isolation;
- plan, entitlement, billing, metering, and budget enforcement;
- hosted secret storage and provider adapters;
- managed CPU/GPU workers, provider selection, job queues, cancellation,
  timeout, retention, and artifact deletion;
- organization administration, SSO/SAML/SCIM, enterprise audit retention,
  private networking, residency, compliance, support, and SLA controls;
- production TLS, rate limits, tracing, health/readiness, alerting, backup,
  recovery, and deployment attestations.

The current capability report marks these operations `hosted-required`,
`provider-unavailable`, or `enterprise-only`. Otis never falls back to an
anonymous shared account or pretends that a hosted provider is available.

## Safe development pattern

Use a loopback SpiderByte server and an HTTPS tunnel for a short-lived
developer-mode test. The tunnel must forward `/mcp` only, preserve the bearer
boundary, and be removed after testing. Do not bind an unauthenticated server
to a public interface.

## Production readiness gate

Do not label the plugin publicly hosted or release-ready until the hosted
services, credential configuration, privacy/support metadata, security review,
dependency/SBOM/license review, and deployment rehearsal have evidence.
