# SpiderByte commercial architecture

Status: implemented commercial boundary and deterministic control-plane
contracts; not a production hosted deployment.

This document describes the commercial workspace added after the Phase 0 audit.
It is deliberately explicit about what is operational in this repository and
what still requires an external provider or deployment authority.

## Boundary and package graph

Open Core remains accountless and local. Nothing in `apps/cli`, `packages/*`,
or the local `kap-server` imports the `commercial/` workspace. The boundary is
checked by `scripts/check-open-core-boundary.mjs` and represented in
`open-core.json`.

The commercial graph is split by responsibility:

```text
commercial/domain
        ↓
commercial/ports ← commercial/adapters
        ↓
commercial/application ── commercial/billing
        ├────────────────── commercial/compute
        ├────────────────── commercial/artifacts
        ├────────────────── commercial/admin
        └────────────────── commercial/enterprise
        ↓
commercial/api ── commercial/sdk ── commercial/mcp
commercial/persistence
```

`domain` contains validated records and lifecycle state. `ports` contains
store, clock, identity, audit, payment, compute, artifact, webhook, and
enterprise provider contracts. `application` owns identity, tenancy,
membership, authorization, invitations, ownership transfer, and audit. The
other domain services own their specialized invariants. API, SDK, and MCP are
adapters around these services, not alternative authorization systems.

## Commercial domain model

The schemas use stable prefixed identifiers, account and organization
ownership, lifecycle state, version/timestamps, actor attribution, and strict
metadata validation. The model map is:

| Area | Records |
| --- | --- |
| Identity | Account, User, Session, IdentityProvider, VerifiedDomain, ServiceAccount, ApiKey |
| Tenancy | Organization, Workspace, Team, Group, Membership, Role, Permission, Invitation |
| Commercial state | Plan, Subscription, Entitlement, Quota, Allowance, Budget, SpendLimit, CreditBalance |
| Metering and billing | UsageEvent, UsageLedgerEntry, ComputeReservation, BillingPeriod, Invoice, PaymentStatus |
| Execution and data | ComputeProvider, ComputeRegion, JobClass, ComputeExecution, HostedArtifact, RetentionPolicy, LegalHold, ExportJob |
| Administration and security | OrganizationPolicy, AuditEvent, SupportAccessGrant, WebhookEndpoint, EnterpriseConfiguration |

Secrets are represented by hashes or secret references. Account passwords,
session tokens, invitation tokens, service-account credentials, API-key
secrets, and webhook secrets are never written to ordinary domain records.
One-time secrets are returned only on the initial successful mutation; an
idempotent replay fails with an explicit one-time-secret-unavailable error.

## Identity, tenancy, and authorization

`CommercialDirectoryService` is the server-side authority for account
creation, login, session validation/revocation, organization and workspace
creation, invitations, membership lifecycle, ownership transfer, and
authorization. `CommercialAuthMiddleware` validates a bearer session through
that directory, including stored session state, token hash, user state, and
expiration. It does not trust a frontend-supplied user or organization.

Authorization is deny-by-default and checks account, organization, workspace,
membership role permissions, service-account scopes, and API-key scopes. Every
commercial service receives an authorization gate; the API entitlement read,
compute refresh/cancel, artifact operations, admin operations, and enterprise
operations all require a server-side authorization decision before accessing
tenant-owned state. Authorization outcomes are audited.

The development identity adapter is explicitly restricted to
`environment: development`. Production identity is a capability adapter and
returns `commercial.identity.not_configured` until an external authority is
configured.

## Plans, entitlements, usage, and billing

`CommercialEntitlementService` loads data-shaped plan records and evaluates
plan, contract, override, and adapter entitlements centrally. Decisions have
one of the meaningful states `included`, `not_included`, `not_configured`,
`configured`, `temporarily_unavailable`, or `not_implemented`. Route handlers,
workers, SDK methods, and MCP tools do not duplicate plan checks.

`UsageLedgerService` records append-only usage events and ledger entries with
account, organization, workspace, actor, run/attempt, provider, resource,
reserved and actual amounts, unit, price basis, currency, source event, and
idempotency keys. Reservations, releases, adjustments, duplicate events,
budget hard limits, and reconciliation are explicit. Invoices are calculated
from posted/reconciled ledger entries, never from mutable UI totals.

`PaymentAdapter` is provider-neutral. `LocalTestPaymentAdapter` is a
deterministic test adapter; `UnavailablePaymentAdapter` is the production-safe
default when a real merchant/invoicing provider has not been configured.

## Hosted compute and artifacts

`HostedComputeControlPlane` implements provider/region/job-class registration,
authorization, entitlement checks, priced reservations, queueing, worker
submission, truthful confirmation, cancellation, inspection, timeout/failure
classification, and usage release/reconciliation. A reservation does not
become `starting` or `running` until the provider returns a matching execution
in a confirmed lifecycle state. Provider, account, organization, region, and
workspace ownership are checked before submission or inspection.

The hosted API does not accept a client-supplied price basis. It requires an
injected `HostedComputePricing` quote port to resolve the server-owned price
book, multiplier, currency, and unit price before submitting a reservation;
without that port the route returns `commercial.compute_pricing.not_configured`.

`HostedArtifactService` uses content-addressed SHA-256 identity, tenant-scoped
ownership, storage entitlement/quota checks, scoped download issuance,
retention, deletion, and legal holds. `HostedArtifactAdapter` is the seam for
object storage, encryption, scanning, export, and signed access. The local
adapter is in-memory and test-only; no production object store is claimed.

## Team, Business, and Enterprise

`commercial/admin` provides team/group membership, custom roles, permission
bundles, service accounts, API-key creation and rotation, organization
policies, support-access grants, webhook endpoints/delivery, audit reads, and
the relevant Team/Business entitlement checks. Support access is explicit,
scoped, time-bound, optionally approval-gated, revocable, and audited.

`commercial/enterprise` provides provider-neutral SAML/OIDC configuration,
SCIM lifecycle contracts, domain verification, enforced SSO prerequisites,
group-to-role mappings, MFA/IP/API restrictions, retention/residency,
customer-managed-key validation, private-network validation, deployment mode,
and release-channel configuration. External adapters report capability status;
draft configuration may be stored, but `production_ready` remains false until
the adapter validates it. Unavailable capabilities fail closed.

## Persistence and transport contracts

`commercial/persistence` defines versioned, checksummed migrations for
foundations, append-only ledger data, idempotency, and audit records. Its
in-memory migration port is deterministic, while `SqlMigrationPort` and
`SqlCommercialStore` provide an injected PostgreSQL-compatible client boundary
with transactional migration application, JSON record persistence, rollback
ordering, and record-key validation. The SQL adapter reports
`not_configured` until a client is supplied; production pooling, credentials,
backups, restore, tenant isolation, and migration operations remain deployment
responsibilities.

`commercial/api` defines request IDs, idempotency headers, bearer-auth context,
consistent error envelopes, and hosted Fastify route/WebSocket adapters. The
route adapters are explicit composition functions and are not registered in
the local Open Core server. WebSocket upgrades authenticate and authorize the
organization before accepting a socket; event delivery is organization and
workspace scoped. The HTTP registry covers account/session onboarding,
organizations/workspaces, entitlement reads, compute lifecycle, artifact
operations, Team/Business team and custom-role mutations, and Enterprise
identity/configuration mutations; each specialized service is injected and
returns a capability error when absent. `commercial/sdk` supplies a fetch transport with
bearer/request/idempotency headers and strips server-controlled actor fields
from public request bodies. `commercial/mcp` exposes a deny-by-default tool
registry that checks principal scope and entitlement before invoking a hosted
operation. The Open Core CLI remains local-only; hosted CLI commands are
unavailable until a separate hosted distribution is authorized and wired.

## Security invariants

- tenant ownership is checked before hosted resource use and before provider
  inspection where possible;
- authorization is backend-enforced, including service accounts and API keys;
- secrets are hashed, referenced, or returned once;
- idempotency records include fingerprints for retryable mutations;
- audit records use a hash chain and verify before export;
- webhook URLs reject credentials, local/private targets, and non-HTTPS URLs;
- payment, identity, database, worker, artifact, SSO, SCIM, KMS, and networking
  failures are unavailable rather than successful;
- local test adapters are named and isolated as test providers and cannot be
  mistaken for production infrastructure.

The repository still needs a dedicated production security review covering
deployment-specific rate limits, SSRF controls at the network boundary,
worker isolation, secret-manager operations, backup/restore, dependency and
license analysis, and adversarial load testing.

See [`SPIDERBYTE_COMMERCIAL_RELEASE_READINESS.md`](../release/SPIDERBYTE_COMMERCIAL_RELEASE_READINESS.md)
for the authoritative capability matrix and external blockers.
