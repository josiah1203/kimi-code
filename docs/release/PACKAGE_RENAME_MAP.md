# SpiderByte package rename and disposition map

Status: migration authority for the current checkout and the publication
topology. Every package manifest has one row in the current package table.
Compatibility and commercial material is retained only as provenance outside
the default workspace and Open Core graph.

## Complete package map

| Current path | Current package | Target path | Target package | Publish target | Disposition and compatibility decision |
| --- | --- | --- | --- | --- | --- |
| `.` | `@spiderbyte/monorepo` | `.` | `@spiderbyte/monorepo` | No | Private repository root; never published as a runtime package. |
| `apps/cli` | `@spiderbyte/cli` | `apps/cli` | `@spiderbyte/cli` | Yes | Canonical CLI package. It publishes exactly one executable, `spyderbyte`. |
| `apps/inspect` | `@spiderbyte/inspect` | `apps/inspect` | `@spiderbyte/inspect` | No | Private local debugging application; excluded from the public package set. |
| `apps/spiderbyte-vscode` | `spiderbyte-vscode` | `apps/spiderbyte-vscode` | `spiderbyte-vscode` | No | Private editor integration; local/BYOK only and excluded from hosted account flows. |
| `docs` | `spiderbyte-docs` | `docs` | `spiderbyte-docs` | No | Private documentation workspace; published documentation is maintained with the repository. |
| `packages/acp-server` | `@spiderbyte/acp-server` | `packages/acp-server` | `@spiderbyte/acp-server` | Yes | Canonical local ACP server; no legacy adapter or hosted route dependency. |
| `packages/agent-core` | `@spiderbyte/agent-core` | `packages/agent-core` | `@spiderbyte/agent-core` | Yes | Canonical unversioned SpiderByte Agent Core runtime. |
| `packages/client` | `@spiderbyte/client` | `packages/client` | `@spiderbyte/client` | Yes | Provider-neutral Klient facade for local memory, IPC, and browser contracts. |
| `packages/kaos` | `@spiderbyte/kaos` | `packages/kaos` | `@spiderbyte/kaos` | Yes | Neutral execution-environment abstraction. |
| `packages/kap-server` | `@spiderbyte/kap-server` | `packages/kap-server` | `@spiderbyte/kap-server` | Yes | Local REST/WebSocket server; hosted Business routes are excluded. |
| `packages/kosong` | `@spiderbyte/kosong` | `packages/kosong` | `@spiderbyte/kosong` | Yes | Neutral LLM/provider abstraction; external provider protocol names remain technical. |
| `packages/minidb` | `@spiderbyte/minidb` | `packages/minidb` | `@spiderbyte/minidb` | Yes | Local persistence and search index package. |
| `packages/oauth` | `@spiderbyte/oauth` | `packages/oauth` | `@spiderbyte/oauth` | Yes | Generic local token storage and explicitly configured external-provider adapters; no SpiderByte account authority. |
| `packages/pi-tui` | `@spiderbyte/pi-tui` | `packages/pi-tui` | `@spiderbyte/pi-tui` | Yes | Neutral terminal UI package. |
| `packages/protocol` | `@spiderbyte/protocol` | `packages/protocol` | `@spiderbyte/protocol` | Yes | Local REST/WebSocket and provider-neutral wire contracts. |
| `packages/sdk` | `@spiderbyte/sdk` | `packages/sdk` | `@spiderbyte/sdk` | Yes | Canonical SDK backed by SpiderByte Agent Core; unsupported v1/hosted methods are removed. |
| `packages/telemetry` | `@spiderbyte/telemetry` | `packages/telemetry` | `@spiderbyte/telemetry` | Yes | Local and opt-in telemetry infrastructure. |
| `packages/transcript` | `@spiderbyte/transcript` | `packages/transcript` | `@spiderbyte/transcript` | Yes | Isomorphic transcript data layer. |
| `packages/tree-sitter-bash` | `@spiderbyte/tree-sitter-bash` | `packages/tree-sitter-bash` | `@spiderbyte/tree-sitter-bash` | Yes | Neutral deterministic shell parser. |
| `compat/commercial-oauth` | `@spiderbyte/commercial-oauth-compat` | `compat/commercial-oauth` | `@spiderbyte/commercial-oauth-compat` | No | Hosted OAuth provenance quarantine; no hosted identity implementation is shipped. |
| `compat/legacy-acp-adapter` | `@spiderbyte/legacy-acp-adapter` | `compat/legacy-acp-adapter` | `@spiderbyte/legacy-acp-adapter` | No | Deprecated v1 ACP compatibility package, excluded from workspace and default graph. |
| `compat/legacy-agent-core` | `@spiderbyte/legacy-agent-core` | `compat/legacy-agent-core` | `@spiderbyte/legacy-agent-core` | No | Deprecated v1 engine provenance, excluded from workspace and default graph. |
| `compat/legacy-migration` | `@spiderbyte/legacy-migration` | `compat/legacy-migration` | `@spiderbyte/legacy-migration` | No | Deprecated migration tooling, excluded from workspace and supported CLI. |
| `compat/legacy-sdk` | `@spiderbyte/legacy-sdk` | `compat/legacy-sdk` | `@spiderbyte/legacy-sdk` | No | Deprecated SDK compatibility tests and fixtures, excluded from the active SDK test graph. |
| `compat/legacy-vis` | `@spiderbyte/vis` | `compat/legacy-vis` | `@spiderbyte/vis` | No | Deprecated visual debugging application, excluded from the Open Core distribution. |
| `compat/legacy-vis/server` | `@spiderbyte/vis-server` | `compat/legacy-vis/server` | `@spiderbyte/vis-server` | No | Deprecated visual debugging server, excluded from the workspace. |
| `compat/legacy-vis/web` | `@spiderbyte/vis-web` | `compat/legacy-vis/web` | `@spiderbyte/vis-web` | No | Deprecated visual debugging web client, excluded from the workspace. |

## Historical rename decisions

These mappings are historical inputs, not additional active package manifests:

- `@moonshot-ai/kimi-code` → `@spiderbyte/cli` (`apps/cli`), publish the `spyderbyte` executable only.
- `@moonshot-ai/kimi-code-sdk` → `@spiderbyte/sdk` (`packages/sdk`), remove v1-only exports and engine accessors.
- `@moonshot-ai/kimi-code-oauth` → `@spiderbyte/oauth` (`packages/oauth`), retain only generic local/external-provider utilities.
- `@moonshot-ai/agent-core-v2` → `@spiderbyte/agent-core` (`packages/agent-core`), canonical unversioned runtime.
- `@moonshot-ai/agent-core` → `@spiderbyte/legacy-agent-core` (`compat/legacy-agent-core`), deprecated compatibility provenance only.
- `@moonshot-ai/klient` → `@spiderbyte/client` (`packages/client`), role-based name chosen for the public facade.
- `@moonshot-ai/acp-adapter` → `@spiderbyte/legacy-acp-adapter` (`compat/legacy-acp-adapter`), removed from the default ACP path.
- `@moonshot-ai/migration-legacy` → `@spiderbyte/legacy-migration` (`compat/legacy-migration`), removed from the supported CLI.

The following non-package surfaces are also dispositioned by the Phase 0
authority and intentionally remain visible here as historical identifiers:

- `apps/cli/src/cli/v2` → `apps/cli/src` (versioned runtime path removed).
- `compat/legacy-acp-adapter/src` → deprecated compatibility directory.
- `packages/acp-server/src` → canonical ACP server path, retained after local conformance.
- `compat/legacy-migration/src` → deprecated compatibility directory.
- `packages/sdk/src` → canonical SDK source, with v1 and hosted exports removed.
- `compat/legacy-agent-core`, `compat/legacy-sdk`, and `compat/legacy-cli` → excluded compatibility paths.
- `packages/kap-server/src/routes/v2/platform.ts`, `packages/client/src/contract/global/platform.ts`, `packages/client/src/core/facade/global.ts`, and `packages/client/src/transports/memory/serviceRegistry.ts` → commercial surfaces removed from the active graph.
- `compat/commercial-agent-core` → excluded commercial implementation quarantine.
- `apps/web` → external browser source; no source or generated bundle is shipped here.
- `apps/cli/dist-web` → stale generated bundle removed from the distribution.
- `apps/cli/package.json#bin.kimi` → legacy executable removed; `spyderbyte` is canonical.
- `package.json#scripts.dev:cli:legacy` → legacy development script removed.
- `KIMI_CODE_LEGACY_FLAG` → legacy runtime flag retired.
- `.kimi-code` → legacy storage path isolated to compatibility material.
- `/provider` → legacy slash command removed; local configuration uses `/connect` and `spyderbyte provider`.

## Rules for applying the map

1. Package metadata, `bin`, exports, declaration paths, repository URLs, and
   dependency specifiers must agree with the target row.
2. `@moonshot-ai/*`, Kimi product names, and legacy executable/storage names
   may appear only in the historical map, legal notices, external-provider
   adapters, or explicitly quarantined compatibility material.
3. The active dependency graph must use `@spiderbyte/agent-core`; it must not
   import a v1 engine or a hosted/commercial implementation.
4. Compatibility and commercial directories are outside the default workspace
   and cannot be reached by the canonical CLI, SDK, server, or client paths.
5. External provider names remain only where they identify an actual provider
   protocol or adapter, never the SpiderByte product or package owner.

## Package acceptance checklist

Each publish target must independently pass metadata, clean declaration,
tarball, dependency, license, secret, SBOM, and isolated-consumer checks.
`npm pack --dry-run` and `npm publish --dry-run` are required; publication is
not performed by this migration.

The tarball must contain no workspace symlinks, private absolute paths,
credentials, unrelated source, stale generated web assets, or commercial
implementation. The package must install from its packed artifact without the
monorepo or workspace protocol.
