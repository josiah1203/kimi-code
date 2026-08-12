# SpiderByte commercial Phase 0 audit

Status: Phase 0 complete. This document is an architecture and readiness
inventory only. It does not claim that hosted, paid, Team, Business, or
Enterprise features are implemented, and it intentionally does not add those
features to the Open Core runtime.

Audit date: 2026-08-11.

## Executive finding

SpiderByte currently has a substantial and useful Open Core platform. Its
canonical runtime is local, accountless, workspace-scoped, and persisted with
local document, append-log, and blob stores. It already contains local
projects, organizations, memberships, policy decisions, approvals, budgets,
usage summaries, provider connections, execution targets, runs, artifacts,
data/ML workflows, REST, WebSocket, SDK, CLI, and MCP/ACP seams.

Those capabilities are not a hosted commercial control plane. The current
authentication credential is a server-local bearer token or configured
password; it has no user or organization subject. Several routes accept an
`actor_id` from the request body, and the platform route helpers resolve a
workspace but do not automatically evaluate authorization. The current usage,
budget, execution, artifact, and event services are local projections, not
commercial-grade tenant, billing, worker, or audit systems.

The repository contains excluded commercial-shaped compatibility code under
`compat/commercial-*`, but those directories are not workspace packages and are
explicitly documented as unsupported quarantine code. They are useful
historical evidence, not a production implementation to enable or copy into
Open Core.

The recommended architecture is a separate `commercial/` workspace containing
commercial contracts, domain, application, ports, infrastructure, API, hosted
runtime, and Enterprise adapter packages. Commercial packages may depend on
Open Core contracts and data-plane adapters. Open Core must never import,
register, or require commercial packages.

## Repository and package inventory

### Current repository map

| Area | Current role | Commercial status |
| --- | --- | --- |
| `apps/cli` | Canonical `spyderbyte` CLI/TUI | Open Core; local control-plane commands only |
| `apps/inspect` | Private web inspector for `kap-server` debug RPC | Open Core development tooling |
| `apps/spiderbyte-vscode` | Private VS Code integration | Open Core client consumer |
| `apps/vis` | Excluded visual compatibility app | Not part of the workspace |
| `packages/agent-core` | Canonical DI × Scope agent engine and local platform services | Open Core; no hosted identity or billing |
| `packages/protocol` | Shared platform/business/data/ML/pipeline/serving contracts | Open Core contract authority; current Business names are local-only |
| `packages/client` | Contract-driven local client facade and transports | Open Core; no hosted principal or plan context |
| `packages/sdk` | Public Node SDK and local harness | Open Core |
| `packages/kap-server` | Local REST/WebSocket server, debug RPC, and current MCP surface | Open Core; not a hosted control plane |
| `packages/kaos`, `packages/kosong` | Execution environment and provider/LLM abstraction | Open Core |
| `packages/minidb` | Embedded local persistence/search implementation | Open Core; not a distributed commercial store |
| `packages/oauth` | Provider-neutral external provider OAuth/token utilities | Open Core; hosted SpiderByte identity excluded |
| `packages/transcript` | Isomorphic transcript contract/rendering data layer | Open Core |
| `packages/acp-server`, `packages/pi-tui`, `packages/telemetry`, `packages/tree-sitter-bash` | Supporting Open Core packages | Open Core |
| `compat/legacy-*` | Legacy implementation and compatibility code | Excluded from supported Open Core graph |
| `compat/commercial-agent-core` | Former membership/entitlement/usage and hosted capability projection | Excluded quarantine; no package manifest |
| `compat/commercial-cli` | Former managed plugin/feedback compatibility code | Excluded quarantine; no package manifest |
| `compat/commercial-oauth` | Former SpiderByte account OAuth and managed-provider usage code | Private, excluded compatibility package |
| `plugins/otis` | Current uncommitted Otis MCP/plugin work | User worktree change; not a commercial control plane |
| Browser web UI | No browser frontend source in this checkout | External frontend; commercial UI is not present |

The current inventory command reports 27 package manifests, 19 workspace
entries, 15 Open Core package entries, and 20 generated-asset paths. The
historical Open Core baseline records 25, 25, 16, and 26 respectively. The
count mismatch is a repository-state drift that must be reconciled before a
release authority is updated; it is not evidence of commercial readiness.

### Workspace and release boundaries

`pnpm-workspace.yaml` currently includes `packages/*`, `apps/*` except
`apps/vis`, and `docs`. `flake.nix` maintains a separate hardcoded workspace
path/name list. Any new commercial workspace must be added to both only after
Open Core release filters, package inventories, and Nix source inclusion rules
are updated together.

`open-core.json` is currently `not-ready`, explicitly excludes hosted Business
and Enterprise implementation, and lists the expected commercial prefixes and
the three `compat/commercial-*` quarantine paths. It has no active commercial
implementation path. The existing Open Core boundary checker is a useful
static guard, but it checks a finite set of imports/tokens and cannot establish
tenant isolation, billing correctness, or hosted security.

## Existing implementation inventory

Status meanings: `implemented/local-only` is real functionality that is safe
for accountless local use; `partial/local-only` is useful groundwork with
missing commercial invariants; `adapter seam` is a reusable boundary, not an
implemented hosted integration; `missing` is not present; `unsafe for hosted`
means it must not be exposed as a hosted capability in its current form.

| Concern | Evidence | Status | Required interpretation |
| --- | --- | --- | --- |
| Local app/workspace/session lifecycle | `packages/agent-core/src/app/workspace*`, `src/workspace`, `src/session`; `packages/kap-server/src/routes/v2` | Implemented/local-only | Preserve as the Open Core data plane |
| Local projects/organizations | `packages/protocol/src/business.ts`; `app/governance/governanceService.ts` | Partial/local-only | Organization mode is literally `local`; no account tenant |
| Local memberships and roles | `app/governance`, `app/authorization` | Partial/local-only | Roles are local project/org roles; no invitation or identity lifecycle |
| Local authentication | `packages/kap-server/src/services/auth`, `middleware/auth.ts` | Implemented/local-only | Server token/password gates one local instance; it is not user/session auth |
| Hosted account/user identity | No supported implementation; old client is in `compat/commercial-oauth` | Missing | Must be a commercial provider-neutral identity port and hosted adapter |
| Local provider connections | `workspace/providerConnections` | Implemented/local-only | BYOK/reference-only secrets; no managed provider account or billing context |
| Secret references | `app/secrets/platformSecretStore.ts` and provider boundary | Implemented/local-only | Opaque local secret storage; no vault/KMS/rotation integration |
| Local policy and approvals | `workspace/policy`, agent permission services | Implemented/local-only | No organization inheritance or commercial approval workflow |
| Local budgets | `workspace/budgets/budgetService.ts` | Implemented/local-only | Workspace reservations and reconciliation; no plan/seat/billing authority |
| Local usage summary | `workspace/usage/usageService.ts` | Implemented/local-only | JSON document projection, not an append-only financial ledger |
| Commercial usage ledger | No current implementation | Missing | Requires immutable events, idempotency, adjustments, reconciliation, and pricing |
| Plans and entitlements | No current implementation; excluded legacy projection only | Missing | Must be centralized in commercial application services |
| Billing/invoices/payments | No current implementation | Missing | Requires payment-provider port and verified webhook adapter |
| Local runs | `session/run/runService.ts`; protocol `Run` | Implemented/local-only | Lifecycle is local agent execution, not hosted job control |
| Hosted compute control plane | No queue/provider registry/worker authority | Missing | Must be a separate control plane with truthful worker-confirmed states |
| Customer-managed execution | `workspace/execution`, `executionTargets` | Implemented/local-only | Reusable adapter seam; not hosted compute |
| Local artifacts | `workspace/artifacts/artifactService.ts` | Implemented/local-only | Content-addressed local blobs and workspace-scoped metadata |
| Hosted object storage/artifacts | No hosted storage adapter | Missing | Requires scoped access, retention, legal hold, export, encryption, and metering |
| Local lifecycle events | `workspace/platformEvents/platformEventService.ts` | Implemented/local-only | Append-log journal per workspace; not a tamper-evident commercial audit log |
| Administrative audit | Governance mutations use change emitters; not all append audit events | Partial/local-only | Commercial admin actions must always produce durable actor-bound audit events |
| REST/WS | `packages/kap-server` v1/v2 routes and WS transport | Implemented/local-only | Existing auth is instance-wide; no hosted principal/tenant middleware |
| SDK/client | `packages/sdk`, `packages/client` | Implemented/local-only | No hosted account/org/plan context; commercial client must be separate or optional |
| MCP/ACP | Core MCP/ACP plus current uncommitted Otis MCP change | Implemented/local-only / worktree change | Must receive capability-filtered principal context before hosted exposure |
| CLI platform commands | `apps/cli/src/cli/sub/platform.ts` | Implemented/local-only | Commands target local accountless organization/project/workspace contracts |
| Product frontend | Browser source is external; local browser transport exists | Missing for commercial | Commercial UI cannot be claimed until connected to hosted contracts |
| Enterprise identity/security | No SAML/OIDC/SCIM/domain/CMK/private-network implementation | Missing | Add fail-closed ports, configuration validation, and test doubles first |

## Current domain and persistence map

### Reusable Open Core anchors

- Stable local IDs and schemas are owned by `packages/protocol/src/platform.ts`
  and the related data/ML/pipeline/serving contract files.
- Workspace-scoped services use the access-pattern persistence interfaces in
  `packages/agent-core/src/persistence/interface` rather than raw database
  access.
- `IAtomicDocumentStore`, `IAppendLogStore`, and `IBlobStore` provide the
  local persistence seams. `packages/minidb` supplies local embedded storage
  and search.
- `WorkspaceArtifactService` provides a content-addressed local artifact
  implementation with metadata, lineage, ranges, expiry, and idempotent
  mutations.
- `WorkspaceUsageService` and `WorkspaceBudgetService` provide useful local
  execution accounting and preflight/reconciliation behavior.
- `WorkspaceExecutionTargetService` and `WorkspaceExecutionService` provide a
  customer-managed worker seam with leases, timeouts, cancellation, retries,
  artifact import, and local accounting.
- `WorkspacePlatformEventService` provides a workspace append-log lifecycle
  stream with sequence cursors.
- `PlatformGovernanceService` and `PlatformAuthorizationService` provide
  accountless local organization/project bindings and role checks.

These are data-plane primitives. Commercial code should reference them through
explicit adapter ports or stable protocol IDs, not reinterpret their local
JSON documents as a hosted database.

### Commercial domain model map

The following models are required in a new commercial domain. Each aggregate
needs a stable ID, ownership/tenant key, lifecycle state, created/updated
timestamps, actor attribution, schema version, archival/deletion behavior,
authorization policy, audit event contract, durable persistence, validation,
and idempotency semantics appropriate to its mutations.

| Domain group | Required models | Current anchor | Phase 0 decision |
| --- | --- | --- | --- |
| Identity | Account, User, Session, IdentityProvider | Excluded `compat/commercial-oauth` client only | New commercial domain and provider ports; never reuse local server token as a user session |
| Tenancy | Organization, Workspace, Team, Membership, Role, Permission, Invitation | Local organization/project/workspace contracts | New commercial aggregates; local workspace IDs may be foreign keys into the data plane |
| Automation identities | ServiceAccount, APIKey | None | New hashed-key/scoped-token model with rotation and revocation |
| Enterprise identity | VerifiedDomain, SSO configuration, SCIM configuration, group mapping | None | New fail-closed adapter contracts and configuration validators |
| Commercial access | Plan, Subscription, Entitlement, Quota, Allowance | None; excluded legacy workspace entitlement projection is insufficient | New centralized entitlement evaluator and decision reasons |
| Accounting | UsageEvent, UsageLedgerEntry, Adjustment, CreditBalance, ComputeReservation | Local `UsageRecord`, `BudgetReservation` | New append-only ledger; local usage remains separate |
| Billing | Invoice, PaymentStatus, BillingPeriod, PriceBook | None | New payment-provider port and webhook/replay protection |
| Spend controls | Budget, SpendLimit, Allocation, Department/Project allocation | Local workspace budget | New organization hierarchy and plan-aware enforcement |
| Compute | ComputeProvider, Region, JobClass, Reservation, ComputeExecution, Lease | Local execution target/lease | New hosted lifecycle and provider registry; local target adapter remains local-only |
| Provider/model access | ProviderConnection, ModelAccessPolicy, SecretReference | Local provider connection and secret reference | New commercial ownership/entitlement wrapper around data-plane provider access |
| Data/artifacts | HostedArtifact, ObjectReference, RetentionPolicy, LegalHold, ExportJob | Local artifact and blob store | New hosted storage/retention domain; do not share local object scope implicitly |
| Governance/security | AuditEvent, OrganizationPolicy, SupportAccessGrant, SecurityEventExport | Local lifecycle events and policy decisions | New immutable, actor-bound commercial audit stream |
| Delivery/integrations | WebhookEndpoint, DeliveryAttempt, EventSubscription | None | New signed, idempotent, replay-protected delivery domain |
| Enterprise configuration | EnterpriseConfiguration, ResidencyPolicy, EncryptionConfiguration, PrivateNetworkAttachment, DeploymentChannel | None | New contracts only until an external provider/infrastructure adapter is verified |

### Proposed package and dependency boundary

Create a top-level `commercial/` workspace, separate from the Open Core
package list and from `compat/`. The exact package names should use the
`@spiderbyte/*` brand and be added to the release authority in the same change
as the workspace and Nix lists.

```text
commercial/contracts        neutral hosted API and domain contracts
commercial/domain           aggregates, value objects, state machines, validation
commercial/ports            persistence, identity, payment, compute, storage, IdP, KMS, delivery ports
commercial/application      authorization, tenancy, entitlements, ledger, billing, admin use cases
commercial/infrastructure   database, queue, object store, provider and external-service adapters
commercial/api               versioned hosted REST/WS/event API and request context middleware
commercial/hosted-runtime    hosted control-plane/data-plane composition and worker coordination
commercial/enterprise        SSO/SCIM/security/residency/private-deployment adapters and contracts
commercial/test-providers    deterministic local payment, identity, storage, and compute doubles
```

The dependency direction must be:

```text
commercial/api -> commercial/application -> commercial/domain
                                      -> commercial/ports
commercial/infrastructure ----------> commercial/ports
commercial/hosted-runtime ----------> commercial/application + Open Core adapters
commercial/enterprise --------------> commercial/ports
commercial/* -----------------------> @spiderbyte/protocol and selected Open Core ports

Open Core packages -X-> commercial/*
local kap-server     -X-> commercial routes, identity, billing, or entitlements
```

`packages/kap-server` remains the local server. A hosted deployment should
compose a commercial API and a data-plane runtime rather than add hosted route
registration to the local server. If a commercial adapter needs a new neutral
data-plane port, add that port to an Open Core package only when it remains
accountless, provider-neutral, and useful locally; the commercial implementation
stays outside the Open Core graph.

## Capability matrix

`Unavailable` means the capability must not be advertised or enabled in that
edition. `Adapter-gated` means a real contract may exist, but the capability is
only available after a verified provider/infrastructure adapter and end-to-end
test. `Local-only` is not a hosted entitlement.

| Capability | Open Core | Individual / Free Hosted | Team | Business | Enterprise | Current evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Local execution and persistence | Implemented, local-only | Optional | Optional | Optional | Optional | Agent Core, local stores |
| Local projects/workspaces/runs/artifacts | Implemented/partial, local-only | Hosted implementation required | Hosted implementation required | Hosted implementation required | Hosted implementation required | Protocol and workspace services |
| BYOK provider/model configuration | Implemented, local-only | Adapter-gated | Adapter-gated | Adapter-gated | Adapter-gated | Provider connection/runtime services |
| Account creation/login/recovery | Unavailable by design | Missing | Missing | Missing | Adapter-gated | Only excluded OAuth client exists |
| Hosted workspace tenancy | Unavailable | Missing | Missing | Missing | Missing | No hosted principal/tenant store |
| Members/invitations/roles | Local partial only | Missing | Missing | Missing | Missing | Local governance roles only |
| Plans/entitlements/quotas | Unavailable | Missing | Missing | Missing | Adapter-gated for contract-specific plans | No evaluator or plan store |
| Hosted usage metering | Local usage summary only | Missing | Missing | Missing | Adapter-gated | Local JSON usage records |
| Billing/invoices/payments | Unavailable | Missing | Missing | Missing | Adapter-gated | No payment adapter |
| Local budgets/policy/approvals | Implemented, local-only | Hosted implementation required | Hosted implementation required | Hosted implementation required | Hosted implementation required | Workspace budget/policy services |
| Hosted compute | Unavailable | Missing | Missing | Missing | Adapter-gated/dedicated deployment | Local/customer-managed execution only |
| Hosted artifacts/retention/export | Local-only | Missing | Missing | Missing | Adapter-gated | Local content-addressed blobs |
| Team shared resources and administration | Unavailable | Missing | Missing | Missing | Missing | No commercial admin API |
| Business RBAC/analytics/webhooks/API keys | Unavailable | Missing | Missing | Missing | Missing | No commercial control plane |
| SAML/OIDC/SCIM/enforced SSO | Unavailable | Unavailable | Unavailable | Adapter-gated | Adapter-gated | No provider contracts |
| Domain verification/group mapping | Unavailable | Unavailable | Unavailable | Adapter-gated | Adapter-gated | No implementation |
| Residency/CMK/private networking/dedicated deployment | Unavailable | Unavailable | Unavailable | Adapter-gated | Adapter-gated | Requires external infrastructure |
| REST/WS/SDK/CLI/MCP access | Implemented local-only | Hosted contracts missing | Hosted contracts missing | Hosted contracts missing | Adapter-gated | Local interfaces do not carry commercial principal context |
| Commercial UI | Unavailable | Missing | Missing | Missing | Missing | Browser source is external to checkout |

## Security and architecture risk register

| Severity | Risk | Evidence | Required mitigation before hosted exposure |
| --- | --- | --- | --- |
| Critical | No authenticated user or tenant subject | `kap-server` accepts one instance bearer token/password; v2 auth explicitly reports local mode | Add provider-neutral principal/session middleware in commercial API; derive actor, org, workspace, and scopes server-side |
| Critical | Request-body actor spoofing | Platform routes accept `actor_id`; governance services authorize the supplied actor | Remove actor authority from public hosted input; use authenticated principal and explicit service-account claims |
| Critical | Platform route authorization is opt-in | `workspaceRequest` and `governanceRequest` resolve services but do not automatically call the authorization service | Centralize authorization/entitlement middleware and require it for every hosted command/query/job/artifact route |
| Critical | No tenant isolation model | Local scope is workspace/process based; no account/org boundary in request context | Add tenant-owned repositories, composite keys, isolation tests, and deny-by-default lookup policies |
| Critical | Usage is not a financial ledger | Local usage is a mutable JSON document plus request map | Build append-only ledger, immutable event IDs, corrections/credits, reconciliation, price basis, currency, and period close |
| Critical | Billing and entitlement enforcement are absent | No plan, subscription, invoice, payment, or centralized evaluator | Implement one application-level evaluator used by API, workers, CLI/SDK adapters, and event consumers |
| Critical | Hosted job truth is absent | Execution service calls a configured customer worker directly; no hosted queue/provider authority | Add reservation/lease/heartbeat state machine and require provider/worker confirmation for running/completed state |
| High | Artifact access lacks hosted authorization/storage controls | Local artifact service uses workspace persistence scope and returns base64 content | Add tenant-scoped object references, signed/scoped access, retention/legal hold, encryption, export, and malware-scan ports |
| High | Audit is incomplete and caller-attributed | Workspace event journal is local; governance uses change emitters; actors are often input fields | Add immutable commercial audit writer with server-derived actor, request ID, correlation ID, retention, and export |
| High | Single credential covers REST, WS, debug, and MCP | Global auth hook protects surfaces with one credential | Separate local instance auth from hosted sessions, API keys, service accounts, scopes, rate limits, and token rotation |
| High | Development auth bypass exists | `disableAuth`/`--dangerous-bypass-auth` is a server option | Keep it impossible in production mode and add deployment configuration checks |
| High | External providers are not present | No payment, IdP, queue, object store, KMS, or hosted compute adapters | Fail closed with capability states: not included, not configured, unavailable, not implemented |
| Medium | Business-shaped local names can mislead | `packages/protocol/src/business.ts` exports organization/project/role/budget contracts with `mode: local` | Rename or clearly namespace local contracts before exposing commercial APIs |
| Medium | Static boundary checks are narrower than the target | Current checker passes but scans a finite token/import set | Extend release checks to commercial dependency closure, route registration, public exports, package tarballs, and generated assets |
| Medium | Baseline and current inventories disagree | Historical baseline is 25/25/16/26; current inventory is 27/19/15/20 | Reconcile authoritative inventory and regenerate release baseline before Phase 1 package changes |
| Medium | Current worktree contains adjacent uncommitted MCP/plugin changes | Otis plugin and `/mcp` route changes are uncommitted | Keep the audit independent; run plugin/MCP security and release checks before commercial integration |

## Migration plan

### Phase 0 — audit and architecture (complete)

- Preserve the accountless Open Core boundary.
- Record package, route, service, contract, persistence, test, and release
  evidence.
- Mark legacy commercial directories as quarantine, not implementation.
- Approve the one-way dependency direction and separate commercial workspace.
- Reconcile inventory counts and define release/readiness statuses.

Exit: this document, the risk register, the capability matrix, and the
commercial package proposal are reviewed before implementation begins.

### Phase 1 — foundations

- Add the commercial workspace and package manifests without adding a reverse
  dependency from Open Core.
- Implement versioned domain contracts and migrations for Account, User,
  Organization, Workspace, Membership, Role, Permission, Invitation, Session,
  ServiceAccount, APIKey, and AuditEvent.
- Add provider-neutral identity, session, tenant-context, repository, clock,
  ID, and idempotency ports.
- Add hosted API request context middleware with deny-by-default authorization.
- Keep local `kap-server` auth and accountless `/api/v2/auth/status` unchanged.
- Add a deterministic local commercial test adapter that is never selected by
  production mode.

Exit: cross-tenant read/write denial, server-derived actor attribution, and
Open Core build/runtime tests pass with commercial packages absent.

### Phase 2 — plans, usage, and billing

- Implement data-driven Plan, Subscription, Entitlement, Quota, Allowance,
  Budget, SpendLimit, UsageEvent, immutable LedgerEntry, Adjustment, Credit,
  Invoice, and PaymentStatus state machines.
- Centralize entitlement decisions and expose reasoned capability states.
- Add append-only ingestion, idempotency, retries, reconciliation, corrections,
  period closing, plan changes, prepaid balances, soft/hard limits, and exports.
- Add a payment-provider port, signed webhook verification, replay protection,
  and a deterministic test billing provider.

Exit: duplicate events, plan upgrade/downgrade, expiration/grace, budget
exhaustion, reconciliation, and payment-failure tests pass.

### Phase 3 — hosted compute and artifacts

- Add ComputeProvider, Region, JobClass, Reservation, Execution, Lease, queue,
  heartbeat, cancellation, timeout, retry, log/event, and failure contracts.
- Implement truthful worker/provider-confirmed lifecycle transitions and
  independent price books/multipliers.
- Add hosted object-storage ports, scoped download/upload, immutable artifact
  identity, retention, legal-hold hooks, export, storage metering, and
  encryption configuration.
- Provide deterministic local worker, fake compute, and fake object-store
  adapters; report production adapters unavailable until end-to-end verified.

Exit: no job reaches `running` without a worker confirmation, tenant-isolation
and artifact authorization tests pass, and reconciliation covers every terminal
state.

### Phase 4 — Team and Business

- Add invitations, membership lifecycle, custom roles/permission bundles,
  groups, service accounts, API keys, shared projects/resources, organization
  policy inheritance, advanced budgets/allocations, analytics, audit export,
  retention, webhooks, support metadata, and administrative access grants.
- Add explicit, time-bound support access with scope, reason, approver,
  expiration, revocation, and complete audit trail.

Exit: every administrative mutation has durable audit evidence and route/CLI/SDK
authorization matrix tests.

### Phase 5 — Enterprise

- Add SAML/OIDC, SCIM, domain verification, enforced SSO, group mapping,
  session/MFA/IP/API controls, key rotation, security export, residency,
  encryption/CMK, private networking, dedicated deployment, release channels,
  backup/DR, compliance evidence, and custom entitlements as contracts first.
- Implement only verified adapters. Missing provider setup must produce a
  stable unavailable/not-configured state and block the operation.

Exit: configuration validation, fail-closed behavior, lifecycle, rotation,
deprovisioning, and adapter conformance tests pass.

### Phase 6 — product integration

- Add hosted-only API/WS versions and schemas without changing local routes.
- Add optional commercial SDK/CLI context, workspace selection, usage/plan
  inspection, compute/artifact access, and authorized admin workflows.
- Connect the external frontend to backend state; distinguish empty,
  unavailable, not configured, and not included.
- Expose only entitlement-filtered MCP/agent tools and audit tool execution.

Exit: each interface has the same success, denial, invalid-input,
cross-tenant, unavailable-adapter, and idempotency behavior.

### Phase 7 — release hardening

- Run migrations, isolation, authorization, ledger, billing, compute,
  artifact, enterprise, failure-mode, load/concurrency, security, dependency,
  license, SBOM, packaging, and documentation checks.
- Rebuild the Open Core release inventory and verify no commercial dependency or
  generated asset enters an Open Core tarball.
- Publish a separate commercial deployment matrix with exact provider,
  credential, infrastructure, and operational prerequisites.

## Test strategy

The existing suite is strong for local behavior but is not a commercial test
suite. Current evidence includes local tests for governance, authorization,
provider connections, policy, budgets, execution, MCP, artifacts through
platform routes, auth middleware, and platform WebSocket events. The tests use
explicit local actors and workspaces; they do not prove hosted identity or
cross-tenant isolation.

Commercial tests should be layered:

1. **Domain tests.** Pure state-machine tests for lifecycle transitions,
   validation, ownership, archive/delete behavior, idempotency, versioning,
   plan changes, ledger corrections, and fail-closed status mapping.
2. **Port contract tests.** The same tests against memory, deterministic local,
   and production-shaped repository, identity, payment, queue, storage, IdP,
   KMS, and worker adapters.
3. **Authorization matrix tests.** Every hosted route and command with success,
   unauthenticated, forbidden, cross-organization, cross-workspace,
   invalid-input, expired-session, revoked-key, missing-entitlement, and
   unavailable-adapter cases.
4. **Accounting tests.** Duplicate usage events, retries, out-of-order events,
   reservations, actuals, adjustments, credits, invoice snapshots, period
   boundaries, plan upgrades/downgrades, grace periods, and reconciliation.
5. **Compute tests.** Reservation/queue/lease/heartbeat, worker confirmation,
   cancellation, timeout, retry, provider failure, budget rejection, tenant
   isolation, artifact upload, and reconciliation-required behavior.
6. **Data/security tests.** Artifact access, signed scopes, retention, legal
   hold, deletion, export, secret redaction, webhook signatures/replay, API-key
   hashing/rotation, support-access expiry, SSRF/private-network rejection,
   path traversal, rate limiting, and sensitive-log checks.
7. **Enterprise adapter tests.** SSO configuration validation, domain
   verification, SCIM create/update/deprovision, group mapping, enforced-SSO
   denial, key rotation, residency/CMK/private-network unavailable states,
   and provider capability reporting.
8. **Open Core regression tests.** Build and run the CLI, local REST/WS/MCP/SDK
   paths, local providers, persistence/restart, artifacts, policies, budgets,
   and exports with commercial packages unavailable and no account credentials.

## Phase 0 release-readiness matrix

| Gate | Current result | Release implication |
| --- | --- | --- |
| Repository/package inventory | Passes structural check; current counts differ from historical baseline | Reconcile before changing package graph |
| Open Core static boundary | Current checker passes | Necessary but insufficient; extend for commercial workspace |
| Open Core accountless architecture | Present in code and docs | Preserve as hard invariant |
| Commercial package boundary | Proposed only; no active package | Not ready for implementation claim |
| Hosted identity/tenancy | Missing | Hosted editions unavailable |
| Entitlements/plans/billing | Missing | Paid editions unavailable |
| Usage ledger/reconciliation | Missing; local summary exists | Billing unavailable |
| Hosted compute | Missing; customer-managed worker seam exists | Hosted compute unavailable |
| Hosted artifacts/retention | Missing; local artifact service exists | Hosted storage unavailable |
| Team/Business administration | Missing | Team and Business unavailable |
| Enterprise integrations | Contracts not present | Enterprise unavailable; adapter-gated only after Phase 5 |
| Frontend commercial surfaces | External source not present | Cannot claim UI integration |
| Security tenant isolation | Not established | No hosted exposure permitted |
| Focused local platform tests | Pass: protocol 29 files/526 tests; agent-core 6 files/23 tests; kap-server 2 files/11 tests; client 1 file/3 tests | Confirms local seams only; does not establish hosted readiness |
| CI/build/typecheck/lint/full test | Not audited in Phase 0 | Do not claim repository release readiness |

## External blockers and required deployment inputs

The following are explicit blockers for a production hosted release; none is
currently verified in this repository:

- A production identity authority and configuration: issuer, client IDs,
  redirect URIs, signing/JWKS rotation, session/revocation policy, and either a
  provider-backed SAML/OIDC/SCIM service or a supported implementation.
- A transactional commercial database with migrations/backups/restore and a
  tenant-isolation strategy; the local JSON/MiniDb stores cannot be the sole
  hosted control-plane authority.
- A durable queue/lease/worker orchestration service and verified compute
  providers for each advertised region/job class.
- An object store, scoped access mechanism, lifecycle/retention service,
  encryption/KMS configuration, export path, and malware/content scanning
  integration where required.
- A payment/invoicing provider, merchant/tax configuration, webhook signing
  secret, replay/idempotency storage, and payment-failure operations.
- Email or equivalent delivery for invitations, recovery, SSO setup, and
  support notifications.
- A secrets manager and key-rotation system for provider credentials, signing
  keys, webhook secrets, and customer-managed-key references.
- Network/security infrastructure for rate limits, private networking,
  regional routing, isolation, observability, backup, disaster recovery, and
  compliance evidence.
- The external browser frontend source and its deployment/configuration for
  commercial account, administration, billing, security, and enterprise
  surfaces.

Until these dependencies are selected, configured, and covered by end-to-end
tests, the corresponding capability must remain unavailable or explicitly
adapter-gated. No UI control, route, or package export should imply success.

## Evidence used

- `open-core.json`
- `config/spiderbyte-release-authority.json`
- `docs/architecture/OPEN_CORE_BOUNDARY.md`
- `docs/architecture/adr-0001-platform-contract-authority.md`
- `docs/release/SPIDERBYTE_OPEN_CORE_MIGRATION_PLAN.md`
- `docs/release/SPIDERBYTE_OPEN_CORE_BASELINE.json`
- `docs/release/PACKAGE_RENAME_MAP.md`
- `packages/protocol/src/platform.ts`
- `packages/protocol/src/business.ts`
- `packages/agent-core/src/app/governance/governanceService.ts`
- `packages/agent-core/src/app/authorization/authorizationService.ts`
- `packages/agent-core/src/workspace/{usage,budgets,artifacts,execution,executionTargets,policy,platformEvents,providerConnections}`
- `packages/kap-server/src/middleware/auth.ts`
- `packages/kap-server/src/routes/v2/platform.ts`
- `packages/client/src/contract/global/platform.ts`
- `packages/client/src/transports/memory/serviceRegistry.ts`
- `packages/sdk/src/platform.ts`
- `compat/commercial-agent-core`
- `compat/commercial-oauth`
- `scripts/inventory-spiderbyte-release.mjs`
- `scripts/check-open-core-boundary.mjs`
- `scripts/verify-spiderbyte-phase-0.mjs`

## Post-audit implementation update — 2026-08-11

The matrix above is the point-in-time Phase 0 record. Phases 1–7 have since
added the separate `commercial/` workspace and its explicit package map. The
implementation is intentionally not treated as a production hosted release:

- `commercial/domain`, `ports`, `application`, and `adapters` define the
  account, user, organization, workspace, membership, invitation, role,
  service-account, API-key, subscription, entitlement, usage, ledger, budget,
  compute, artifact, audit, support, webhook, and enterprise contracts.
- `commercial/billing` centralizes plan and entitlement evaluation, append-only
  usage accounting, budget enforcement, reconciliation, invoice calculation,
  payment state, and idempotent subscription/invoice mutations.
- `commercial/compute`, `artifacts`, `admin`, and `enterprise` implement the
  control-plane orchestration and fail-closed adapter boundaries. Their
  `LocalTest*` adapters are deterministic test providers; they are not
  production infrastructure.
- `commercial/api`, `sdk`, and `mcp` provide hosted transport adapters and
  contracts. Fastify REST registration and authenticated `ws` upgrades remain
  explicit composition functions; no commercial routes are registered in
  `kap-server`, and the Open Core CLI remains local-only.
- `commercial/persistence` provides reversible migration definitions,
  `SqlMigrationPort`, and an injected transactional SQL store. It reports
  `not_configured` without a client and does not claim production database
  operations, backups, restore, or isolation evidence.
- The SDK regression suite verifies that actor/principal fields are not sent as
  authority-bearing hosted body data and that nested workspace paths match the
  registered API route. HTTP replay conflicts, unavailable billing, event
  scoping, SQL transaction rollback, and fail-closed WebSocket upgrades are
  covered by deterministic commercial tests.

The current implementation status, verification evidence, and remaining
external blockers are maintained in
[`SPIDERBYTE_COMMERCIAL_ARCHITECTURE.md`](./SPIDERBYTE_COMMERCIAL_ARCHITECTURE.md)
and
[`SPIDERBYTE_COMMERCIAL_RELEASE_READINESS.md`](../release/SPIDERBYTE_COMMERCIAL_RELEASE_READINESS.md).
