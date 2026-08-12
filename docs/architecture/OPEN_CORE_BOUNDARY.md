# SpiderByte Open Core boundary

The Otis MCP/plugin-specific architecture and capability status authority is
[`SPIDERBYTE_OTIS_PLUGIN_ARCHITECTURE.md`](./SPIDERBYTE_OTIS_PLUGIN_ARCHITECTURE.md).

Status: normative target contract. This document describes the boundary that
the implementation and audits must enforce; it does not assert that the
current repository already satisfies it.

The machine-readable authority at
[`config/spiderbyte-release-authority.json`](../../config/spiderbyte-release-authority.json)
declares this document, its required headings, and the narrow path-specific
allowlists. The boundary checker validates that this authority is present
before evaluating repository source; the allowlists never suppress a
commercial implementation or route.

## Definition

SpiderByte Open Core is the local, provider-neutral, self-hostable platform.
An external developer must be able to clone the repository, install its
dependencies, start `spyderbyte`, configure a local or BYOK provider, execute
local work, and inspect persisted results without a hosted SpiderByte account
or Business service.

The boundary is architectural, not just a list of forbidden words. A package
is inside Open Core only when its implementation, dependency graph, public
types, routes, generated artifacts, and supported documentation can operate
under that local contract.

## Open Core package responsibilities

| Layer | Canonical responsibility | Boundary requirement |
| --- | --- | --- |
| CLI/TUI | `@spiderbyte/cli` and `spyderbyte` | Must bootstrap the local runtime directly and must not silently select v1 or a hosted service. |
| SDK/client | `@spiderbyte/sdk` and `@spiderbyte/client` | Must expose only implemented, local/provider-neutral operations and stable capability errors. |
| Agent runtime | `@spiderbyte/agent-core` | Must be the unversioned SpiderByte Agent Core; v1 and commercial implementations are outside its graph. |
| Server/contracts | `@spiderbyte/kap-server`, `@spiderbyte/protocol` | Must register only local REST/WebSocket/IPC capabilities advertised by Open Core. |
| Execution/providers | `@spiderbyte/kaos`, `@spiderbyte/kosong`, local/BYOK adapters | Must use explicit provider-neutral contracts; provider names may remain when technically required. |
| Persistence/data | `@spiderbyte/minidb`, `@spiderbyte/transcript`, local workspace services | Must support durable local workspaces, sessions, runs, artifacts, lineage, policy, budget, and usage state. |
| Extensibility | ACP/MCP and generic plugin contracts | May define neutral interfaces and fully supported local adapters; cannot import hosted implementations. |
| Developer tooling | docs, tests, inspect/visual-debugging apps | May remain private and auxiliary, but must not leak commercial implementation into publishable packages. |

The intended publish set and each package's disposition are authoritative in
[`PACKAGE_RENAME_MAP.md`](../release/PACKAGE_RENAME_MAP.md). Private inspect,
visual-debugging, documentation, and compatibility packages are not evidence
that the public Open Core surface supports their capabilities.

## Explicitly excluded capabilities

The following are Business/Enterprise or hosted capabilities and must not be
implemented, registered, or required by Open Core packages:

- hosted identity authority, hosted tenancy, organization administration
  controlled by a hosted service, SSO/SCIM, or enterprise directory;
- paid entitlements, seat subscriptions, billing, invoices, plans, and a
  commercial usage ledger;
- managed OpenRouter, managed Modal, hosted workers, hosted scheduling,
  hosted storage, or hosted external execution;
- Slack, Teams, hosted approval routing, or hosted notification workflows;
- private deployment services, enterprise networking, residency controls, or
  other commercial operational services.

Open Core may contain local organizations, projects, workspaces, policies,
approvals, budgets, usage records, provider connections, and execution
contracts when they are local, deterministic, and usable without hosted
authority. Similar vocabulary does not make a local implementation
commercial. The deciding test is whether the implementation requires or
represents a hosted commercial authority.

When an excluded capability needs an integration seam, Open Core may retain a
provider-neutral interface, capability descriptor, or adapter contract. The
interface must not import the commercial package, expose commercial-only
types, register a hosted route, or silently provide a fake implementation.
When the capability is unavailable, the supported surface must either omit it
or return a stable documented capability error.

## Required removals from the current graph

The baseline boundary audit identifies these active paths. They are migration
targets, not allowed exceptions:

| Current path | Finding | Required disposition |
| --- | --- | --- |
| `packages/agent-core/src/workspace/commercial` | Commercial implementation in an Open Core package | Move to the excluded commercial distribution or remove; no canonical runtime import. |
| `packages/agent-core/src/errors.ts` | Commercial module path in public error surface | Replace with local capability/error contracts; retain only precise compatibility documentation if legally necessary. |
| `packages/agent-core/src/index.ts` | Commercial service import/re-export | Remove from the canonical Agent Core entry point. |
| `packages/kap-server/src/routes/v2/platform.ts` | `IWorkspaceCommercialService` route dependency | Remove commercial route registration and keep only local platform routes. |
| `packages/client/src/contract/global/platform.ts` | `commercialContract` public contract | Remove from the public client contract; add only neutral local capability contracts. |
| `packages/client/src/core/facade/global.ts` | `GlobalCommercialFacade` | Remove the facade from the canonical client surface. |
| `packages/client/src/contract/index.ts` | Commercial barrel exports | Remove commercial types and exports. |
| `packages/client/src/index.ts` | Commercial facade export | Remove commercial exports from the package entry point. |
| `packages/client/src/transports/memory/serviceRegistry.ts` | Commercial service registration | Register only local services and neutral extension points. |
| `apps/cli/dist-web` | Removed generated web bundle | No Open Core browser bundle is shipped; the exact stale bundle was moved out of the checkout for recovery during migration review. |
| `apps/web` | Referenced authoritative source is absent | The browser client is explicitly external to this checkout; only the local REST/WebSocket API is supported here. |

The exact current findings and counts are recorded in the migration plan's
baseline. The final audit must detect implementations, imports, dependency
edges, route registrations, exports, declarations, and tarball contents—not
just these current path strings.

## Dependency and ownership rules

1. Canonical applications may depend on `@spiderbyte/*` packages according to
   their role, but no supported CLI, SDK, client, server, or ACP path may
   import the legacy v1 runtime.
2. `@spiderbyte/sdk` and `@spiderbyte/client` may depend on local runtime
   contracts, but may not resolve a commercial service locator, commercial
   route, entitlement type, hosted identity type, or commercial implementation.
3. `@spiderbyte/agent-core` may depend on local persistence, execution,
   provider, transcript, telemetry, and protocol packages. It must not depend
   on a commercial package, the legacy v1 engine, or a hosted authority.
4. The local server must register routes from the supported local contract
   only. A commercial route cannot be made acceptable by registering it
   conditionally in the same Open Core server package.
5. Compatibility packages belong under `compat/`, are excluded from the
   default workspace/build graph, have a documented removal plan, and must be
   covered by tests proving canonical paths do not resolve them.
6. External provider names, protocol names, copyright notices, and upstream
   attribution are permitted when their meaning is technical or legal. They
   must not be used to preserve SpiderByte's former product identity in active
   package names, commands, paths, or default documentation.

## Boundary checker contract

The boundary checker must consume this document's package/disposition data and
the structured allowlist. It must fail on:

- commercial implementation files under an Open Core package;
- source imports, package dependencies, generated declarations, or exports
  that resolve commercial modules or commercial-only types;
- commercial route or service registration in the local server/client
  transports;
- commercial capabilities reachable through SDK, client, protocol, or CLI
  public entry points;
- stale generated web output that has no authoritative source and reproducible
  build/sync command;
- commercial code, credentials, workspace-only references, or excluded
  assets inside a package tarball.

Allowlisting must be narrow and explainable. Each intentional match records
the exact path, token, category, reason, owner, and review/removal date.
Broad token suppression, repository-wide regular expressions, and “warning”
classification for a blocker are not permitted.

## Local capability contract

The supported local surface must cover the following without a hosted service:

- accountless local organization/project/workspace bootstrap;
- local Sessions and Runs, durable persistence, restart, and lifecycle
  deletion;
- local or BYOK provider configuration and provider-neutral execution;
- artifacts, lineage, transcript/replay/import, and inspection;
- policies, approvals, budgets, and usage decisions with stable outcomes;
- supported MCP/ACP and REST/WebSocket capabilities where advertised;
- SDK and client parity across memory and IPC transports, plus browser
  transport only if its implementation and source are present and tested;
- stable public error envelopes for absent optional host capabilities.

Every advertised capability requires an implementation, type coverage, unit
tests, integration tests, documentation, and an intentional failure test for
an absent host capability. A public method that always returns
`not_implemented`, `executor-unavailable`, or a silent v1 fallback does not
meet this contract; it must be implemented or removed from the supported
surface.

## Required release evidence

Before `open-core.json` can be marked ready, CI and the clean-checkout
rehearsal must provide:

- zero Open Core boundary blockers and zero unintentional branding findings;
- zero unresolved package-rename findings, v1 runtime dependencies, or
  supported SDK stubs;
- passing local accountless startup, Run, artifact, policy, budget, restart,
  SDK, client, and server tests;
- tarball installation without workspace-only symlinks or unavailable source;
- resolved dependency/license/ownership SBOM, secret scan, provenance, and
  license validation;
- a reproducible build, upgrade rehearsal, rollback rehearsal, and CI
  configuration that runs the same gates on pull requests.

Until every required result is green, the repository is not ready for GitHub
publication and the report must identify the failing gate as a blocker.
