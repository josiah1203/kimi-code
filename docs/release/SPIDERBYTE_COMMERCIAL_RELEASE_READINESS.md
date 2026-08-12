# SpiderByte commercial release-readiness matrix

Status: not production-ready. This matrix is intentionally conservative: a
capability is not marked ready because a schema, button, or deterministic test
adapter exists.

## Capability matrix

| Capability | Repository status | Evidence or exact blocker |
| --- | --- | --- |
| Open Core local execution and accountless operation | Implemented in the existing Open Core graph | Open Core boundary checker and local platform suites; no commercial imports |
| Commercial domain records and validation | Implemented and unit-tested | `commercial/domain`, strict schemas and lifecycle fields |
| Commercial store and migrations | Injected SQL adapter and migration runner operational when a client is supplied; unavailable without one | `commercial/persistence`; production driver/pooling, credentials, backups, restore, migration operations, and tenant-isolation evidence remain external |
| Account creation, login, sessions, invitations, tenancy, roles | Implemented against provider-neutral ports; development adapter only | `commercial/application`; production identity authority is required |
| Server-side authorization and audit chain | Implemented and tested in application/services | Requires integration into the selected hosted gateway and operational audit retention |
| Plans, entitlements, quotas, budgets, subscription state | Implemented and tested | `commercial/billing`; plan catalog is data-shaped and adapter status is explicit |
| Usage ledger, idempotency, reconciliation, projections | Implemented and tested | Append-only in the commercial store; production durability and reconciliation jobs remain deployment work |
| Payment, invoices, payment failure states | Test adapter operational; production adapter-gated | Requires payment/invoicing provider, tax/merchant setup, signed webhooks, and operations |
| Hosted compute reservations and truthful lifecycle | Local deterministic control plane/test adapter operational; hosted API requires an injected server-owned pricing quote | Requires durable queue, lease/heartbeat worker service, verified providers, price book, regions, quotas, and isolation |
| Hosted artifacts, retention, legal holds, scoped downloads | Local deterministic adapter operational; production storage-gated | Requires object store, signed access, encryption/KMS, scanning, export, lifecycle workers |
| Team and Business administration | Contracts and deterministic service operational | External identity, durable DB, webhook delivery, analytics, and hosted API deployment required |
| API keys and service accounts | Implemented with hashing, scopes, rotation, one-time secret behavior | Production secret manager, rate limiting, key lifecycle operations, and gateway integration required |
| Webhooks and event delivery | Contract and safe URL/idempotency layer implemented; delivery unavailable by default | Requires production queue/delivery worker, signing secret management, retry/dead-letter operations |
| SAML/OIDC SSO and enforced SSO | Contract plus local test adapter; adapter-gated | Requires selected IdP, issuer/JWKS or SAML metadata, callback/session integration, and E2E tests |
| SCIM provisioning and group sync | Contract plus local test adapter; adapter-gated | Requires selected SCIM authority, sync jobs, deprovisioning policy, and E2E tests |
| Domain verification | Local deterministic adapter; production DNS/HTTP adapter-gated | Requires DNS/HTTP verification service and operational replay/expiry handling |
| CMK, private networking, residency, deployment channels | Configuration contracts and validation; infrastructure-gated | Requires KMS, network, regional/dedicated deployment, residency, backup, and isolation evidence |
| Commercial REST/WebSocket routes | Fastify route and `ws` upgrade adapters implemented outside Open Core; fail-closed auth/capability behavior tested | Hosted gateway deployment, rate limiting, observability, durable event delivery, and production identity authority are not deployed here |
| Commercial SDK | Typed fetch transport plus server-controlled request-body/path contracts | Hosted endpoint and authentication authority are not deployed here |
| Commercial MCP | Deny-by-default hosted tool registry | Not registered in Open Core MCP; hosted session/tool gateway is required |
| Commercial CLI | Unavailable | Open Core CLI remains local-only; no hosted account/admin command surface is registered |
| Commercial frontend | Unavailable in this repository | Browser source is external; no commercial UI is wired to these contracts |

## Phase completion record

| Phase | Result | Remaining release gate |
| --- | --- | --- |
| 0 — Audit and architecture | Complete | Keep the audit and boundary authority synchronized |
| 1 — Foundations | Complete at contract/service level | Production identity, DB, hosted gateway integration |
| 2 — Plans, usage, billing | Complete with test payment adapter | Production payment provider, durable jobs, reconciliation operations |
| 3 — Compute and artifacts | Complete with deterministic adapters | Real workers/providers/object storage and lifecycle operations |
| 4 — Team and Business | Complete with service contracts | Hosted API, identity, delivery, analytics, support operations |
| 5 — Enterprise | Complete as fail-closed contracts/adapters | Provider/infrastructure selection and end-to-end verification |
| 6 — API/SDK/MCP/UI integration | API route/WebSocket adapters, SDK transport contracts, and deny-by-default MCP registry complete; UI/CLI unavailable | Hosted route deployment and external frontend source |
| 7 — Release hardening | Partial | Security/load/dependency/license/SBOM/clean-checkout/CI and production rehearsals |

## Verification evidence

The following passed on 2026-08-11:

- all 13 `commercial/*` workspaces build;
- all 13 `commercial/*` workspaces typecheck;
- 12 commercial test files pass, 41 tests total; `commercial/ports` has no
  test files and uses an explicit pass-with-no-tests script;
- Phase 0 inventory, Open Core boundary, and Phase 0 verifier pass;
- the focused Open Core platform suites recorded in the Phase 0 audit remain
  separate from the commercial suites.

These results establish deterministic code and boundary behavior only. They do
not establish hosted production readiness.

## External blockers and required inputs

Before a hosted Free, Team, Business, or Enterprise release can be claimed,
the release owner must select, configure, and end-to-end test:

1. identity authority and email/recovery delivery, including OIDC/SAML/SCIM,
   session revocation, JWKS/metadata rotation, and enforced-SSO behavior;
2. transactional commercial database, migration runner, backups, restore,
   disaster recovery, tenant isolation, and audit retention;
3. queue/lease/worker orchestration, compute providers, regions, quotas,
   cancellation, timeout, heartbeat, and reconciliation operations;
4. object storage, signed/scoped access, encryption/KMS, malware/content
   scanning, export, retention, legal hold, and deletion workflows;
5. payment/invoicing provider, merchant/tax configuration, webhook signing,
   replay protection, refunds/credits, payment-failure policy, and invoice
   operations;
6. secrets manager and key rotation for identity, provider, API-key, webhook,
   signing, and customer-managed-key material;
7. hosted gateway/WebSocket event infrastructure with request IDs, rate
   limits, quotas, observability, and production authorization integration;
8. external frontend source/deployment for onboarding, administration,
   usage, billing, security, SSO, SCIM, and enterprise configuration;
9. security review, load/concurrency testing, dependency/license audit, SBOM,
   incident response, and clean-checkout/package rehearsal.

Until these inputs have evidence, the corresponding feature must remain
`not_configured`, `temporarily_unavailable`, or unavailable. This repository
does not claim a commercially deployable hosted product yet.
