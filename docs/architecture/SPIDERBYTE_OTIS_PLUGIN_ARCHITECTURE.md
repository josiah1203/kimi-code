# SpiderByte Otis plugin architecture

Status: implementation authority for the Otis plugin and the local MCP
adapter. This document records what is actually shipped in this checkout. It
does not turn a planned hosted service into an implementation.

## Product and package identity

The canonical public product spelling is **SpiderByte**. The executable and
package namespace use the lower-case-compatible `spyderbyte` and
`@spiderbyte/*` forms. The alternate capitalized spelling is not adopted as
product branding; existing internal identifiers that use it remain only for
compatibility and are not a pattern for new APIs. The user-facing OpenAI
plugin is named **Otis**.

| Concern | Canonical value | Status |
| --- | --- | --- |
| Public product name | SpiderByte | canonical repository and release authority |
| Alternate capitalized spelling | Not adopted | retained only where existing code/API compatibility requires it |
| CLI executable | `spyderbyte` | implemented |
| Public npm packages | `@spiderbyte/*` | implemented |
| MCP server name | `spiderbyte` | implemented |
| OpenAI/Codex plugin | `otis` / Otis | implemented locally |
| Local stdio command | `spyderbyte mcp --profile curated` | implemented; curated Otis surface |
| HTTP MCP endpoint | `/mcp` | implemented; stateless MCP 2026-07-28; profile selected by `SPIDERBYTE_MCP_PROFILE` |
| Default Codex model | `gpt-5.3-codex` in the repository `.codex/config.toml` | configured |

No package rename is performed as part of the plugin work. Existing legacy
identifiers remain subject to the repository’s package-rename and open-core
migration documents.

## Integration classification

Otis is a **skills plus MCP server** package and is intended to be a
submission-ready production package only after a separately deployed HTTPS
MCP endpoint, privacy policy, support contact, and organization review exist.
The current checkout is ready for local developer-mode testing; it is not a
publicly submitted or hosted production application.

The MCP server remains useful without a UI. No MCP Apps resource is registered
in this release, so Codex, ChatGPT MCP-compatible surfaces, and future MCP
clients receive the same headless structured tool results. A UI is `planned`,
not silently implied by the plugin manifest.

Supported paths:

| Client | Transport | Current status |
| --- | --- | --- |
| Codex CLI | local stdio through `spyderbyte mcp --profile curated` | implemented/local-only |
| Codex IDE extension | the shared Codex MCP configuration | supported by configuration; local-only |
| ChatGPT Developer Mode / MCP surfaces | authenticated Streamable HTTP at `/mcp` | implemented in the server; requires a reachable HTTPS deployment or development tunnel |
| Future MCP-compatible clients | Streamable HTTP or stdio | protocol adapter implemented; client-specific setup is not claimed |

## Capability status vocabulary

Every capability report and unavailable response uses one of these statuses:

| Status | Meaning in this checkout |
| --- | --- |
| `implemented` | The operation is exposed and backed by a canonical service. |
| `local-only` | Implemented without hosted SpiderByte authority. |
| `hosted-required` | The workflow needs a commercial hosted control plane or hosted worker that is not present. |
| `credential-required` | The local contract exists, but the operator must configure a provider or secret reference. |
| `provider-unavailable` | A provider-specific adapter, such as OAuth, is not implemented. |
| `enterprise-only` | The feature belongs to an enterprise distribution and is not in Open Core. |
| `disabled` | Deliberately not enabled in the current runtime. |
| `planned` | A product direction with no current implementation. |

## Open-core boundary

The adapter is an MCP boundary over the existing local services. It does not
create a second persistence or execution backend.

Open Core owns:

- local accountless organizations, projects, workspaces, sessions, and Runs;
- local datasets, profiles, queries, transforms, artifacts, downloads, and
  lineage;
- local analysis, experiments, training, evaluation, model registration, and
  model staging when a permitted local or customer-managed target is configured;
- local provider connections and opaque BYOK secret references;
- local policy decisions, approvals, budgets, usage, and append-only platform
  events;
- local CLI/TUI, SDKs, REST/WebSocket, ACP, MCP, protocol contracts, and tests.

The commercial boundary is outside this checkout and must depend on these
contracts rather than fork them. It includes hosted identity and tenancy,
membership, billing, entitlements, metering, managed secrets, hosted artifact
storage, managed GPU/CPU workers, provider orchestration, collaboration, SSO,
SCIM, enterprise retention, private deployments, compliance controls, and
support/SLA features.

The repository’s machine-readable boundary remains
[`open-core.json`](../../open-core.json), with the normative general boundary
in [`OPEN_CORE_BOUNDARY.md`](./OPEN_CORE_BOUNDARY.md).

## MCP tool surface

`packages/kap-server/src/mcp/server.ts` is the canonical adapter. It uses the
official TypeScript MCP v2 server package (`@modelcontextprotocol/server`) and
registers versioned, headless tools with Zod input and output schemas. Tool
descriptions begin with “Use when”, and every tool declares `readOnlyHint`,
`openWorldHint`, and `destructiveHint`, plus `idempotentHint` for the
operations where it is meaningful.

### Curated Otis profile

The plugin passes `--profile curated`, which exposes exactly these semantic
tool names: `list_workspaces`, `list_projects`, `list_execution_targets`,
`create_run`, `get_run`, `cancel_run`, `list_artifacts`, `get_artifact`,
`profile_dataset`, `run_sql_analysis`, `train_baseline_model`,
`get_capabilities`, and `request_approval`. Each is backed by the existing
App/Workspace/Session services; the curated profile does not expose internal
REST routes or the broader `spiderbyte_*` inventory. Curated structured
results are bounded to 64 KiB and text summaries to 8,000 characters.

`train_baseline_model` composes the canonical Agent Core baseline workflow,
creates an idempotent durable Run, records success/failure transitions, and
returns stable Run and artifact IDs. It requires `confirmed: true` and remains
subject to workspace authorization, policy, budget, and execution-target
checks. Concurrent retries in one daemon process coalesce on an in-flight
claim; restart recovery for a Run left `running` is deferred to the unified
Run/Attempt phase.

### Implemented local families

- capabilities, account/connection status, workspaces, sessions;
- local organizations, projects, project permissions, and workspace bindings;
- datasets, metadata, profiles, queries, and transforms;
- artifacts, bounded content retrieval, and lineage;
- Runs: list/get/create/transition/cancel/resume/retry/rerun/compare;
- analyses, experiments, training runs, evaluations, models, and comparisons;
- provider connections and execution targets, without secret material;
- policies, explanations, approvals, budgets, usage, and event replay;
- standard `search` and `fetch` over stable `spiderbyte://` resource URIs.

The full developer profile retains the broader local families for repository
inspection and administrative workflows. Run planning and starting are
represented by the canonical Run lifecycle:
`spiderbyte_create_run` creates a queued plan envelope and
`spiderbyte_transition_run` records planning, approval, running, completion, or
failure. The underlying Run contract has no separate durable attempt entity;
therefore Otis does not expose a fake “attempts” table. Run retry/rerun
operations and platform event replay are the supported equivalents.

### Explicitly unavailable families

The adapter exposes `spiderbyte_explain_unavailable` for hosted compute
estimates/providers/profiles/jobs/logs/outputs/machines, hosted identity,
billing, team membership, provider OAuth, SSO/SCIM, private deployments, and
enterprise retention. These calls return a structured status and a local
alternative. They do not create anonymous jobs, use a shared account, or
pretend that a provider is configured.

## Transport and request boundary

The local HTTP server registers the official MCP 2026-07-28 Streamable HTTP
handler at `/mcp`. Modern requests carry the per-request `_meta` envelope and
the `MCP-Protocol-Version`, `Mcp-Method`, and method-specific `Mcp-Name`
headers. The handler is stateless: it does not issue or retain
`Mcp-Session-Id`, does not use SSE resumability, and creates a fresh server
instance for each HTTP request. The v2 SDK also provides a stateless 2025-era
fallback for older clients; that compatibility path is not a protocol session.
The route adds a bounded per-source rate limit and keeps the existing Fastify
host/origin/auth hooks. HTTP MCP requests require the same local bearer
credential that protects the REST and WebSocket surfaces. `OPTIONS` remains a
CORS preflight bypass.

The CLI starts the same server composition without opening a TCP listener and
serves it through the official v2 `serveStdio` entry. Modern and legacy stdio
clients are selected per connection; workspace calls still resolve through the
same App, Workspace, and Session scopes.

For every workspace-scoped call the adapter:

1. requires an explicit `workspace_id` or a documented local default;
2. resolves the workspace through `IWorkspaceService` and
   `IWorkspaceLifecycleService`;
3. verifies session ownership before loading a session;
4. appends `mcp_invocation.created`, then a completed or failed event;
5. propagates the MCP request ID or idempotency key into the durable request ID;
6. bounds result text and redacts secret-like fields before model-visible output.

Paths supplied for session creation are confined to the selected workspace.
Stable fetch URIs include the workspace identity, and cross-workspace URIs
fail closed.

## Authentication and authorization status

Local stdio is process-scoped and does not make a network call. Local HTTP is
bearer-protected by the existing token service. Workspace scope and canonical
local policy services remain required before execution or approval changes.

Hosted account sign-in, tenant membership, OAuth authorization-code/PKCE,
refresh/revocation, plan checks, billing checks, and commercial entitlement
enforcement are **hosted-required** or **provider-unavailable** here. No
provider OAuth or hosted identity implementation is claimed.

## Data flow

```text
Codex / ChatGPT / MCP client
        │ stdio or authenticated Streamable HTTP
        ▼
Otis MCP adapter (`kap-server`)
        │ validation, scope, redaction, audit, rate limit
        ▼
SpiderByte App → Workspace → Session services
        │
        ├─ local persistence / MiniDB / transcript / artifacts
        ├─ local policy / approval / budget / usage events
        └─ explicit local or BYOK provider / execution target
```

There is no hosted data plane in this repository. An external provider call is
possible only when the existing local provider configuration and credentials
permit it; the MCP layer never prints those credentials.

## Release status

Current release status is:

- local developer-mode package: **implemented and validated**;
- local Codex CLI/IDE MCP configuration: **implemented**;
- local Streamable HTTP endpoint: **implemented and contract-tested for MCP
  2026-07-28**;
- packed package artifacts: **rehearsed for all 15 publish targets**;
- direct plain-Node execution of the monorepo CLI `dist` file: **limited** by
  the existing Agent Core source workspace export; use the dev runner in a
  checkout or a packed/installable CLI artifact;
- ChatGPT UI resource: **planned**;
- hosted deployment: **not implemented in this checkout**;
- hosted OAuth/tenancy/billing/compute: **unavailable**;
- public OpenAI plugin submission: **not submitted**;
- public release: **not ready** until production HTTPS hosting, privacy/support
  metadata, final security/dependency/SBOM gates, and organization review are
  complete.

The exact evidence and remaining blockers are tracked in the repository’s
[`REVIEW_ARTIFACTS.md`](https://github.com/SpiderByte/spiderbyte/blob/main/plugins/otis/submission/REVIEW_ARTIFACTS.md).
