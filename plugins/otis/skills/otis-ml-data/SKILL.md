---
name: otis-ml-data
description: Use when working in the SpiderByte repository on agent runtime, model/provider catalogs, datasets, artifacts, experiments, training, evaluation, transcript/search read models, or MiniDB persistence.
---

# Otis: ML and data work in SpiderByte

Otis is the repo-aware workflow for SpiderByte's governed, local-first agent platform. Use it when a task crosses the agent runtime, LLM/provider configuration, data lifecycle, ML execution, search/read models, or durable transcript state.

For the complete SpiderByte engine tool inventory, plugin/MCP boundary, public SDK/server surfaces, and repository map, also use the `otis-spiderbyte` skill.

## Activation conditions

Activate for dataset, artifact, experiment, training, evaluation, model,
provider, transcript, search, MiniDB, or ML/data execution requests.

## Required MCP tools

Use `get_capabilities`, then the applicable curated dataset, artifact,
execution-target, baseline-training, Run, and approval tools. Use the full
developer profile or local service APIs for search, fetch, detailed experiment
management, policy, usage, and evaluation operations not exposed by Otis.

## Confirmation

Ask before training, model staging, cancellation, external execution, or any
operation that may consume compute or alter durable data.

## Failure handling

Report validation, policy, provider, credential, execution-target, and
workspace failures explicitly. Hosted compute and provider OAuth are not
available in Open Core.

## Expected output

Return dataset/model/run identifiers, lineage, execution location, metrics,
limitations, capability status, and the exact validation command used.

## Examples

- “Profile this dataset, identify quality risks, and save the analysis.”
- “Compare the last two local experiments and explain the metric tradeoff.”

## Privacy

Do not print secrets, raw credentials, unbounded dataset rows, private prompts,
or sensitive telemetry. Keep artifact content bounded and workspace-scoped.

## Default Codex model

This repository selects `gpt-5.3-codex` in the project-scoped `.codex/config.toml` for trusted Codex sessions. Honor an explicit user or session model override. If the project config is not loaded, use `gpt-5.3-codex` explicitly for Otis work when the caller has not selected another model; do not claim that the plugin manifest changed the model. Codex model selection is configuration, not a supported `plugin.json` field.

## Repository map

- `apps/cli` is the canonical CLI/TUI application and is described as a workspace for agents, data, and ML. It consumes core behavior through `@spiderbyte/sdk` and `@spiderbyte/agent-core`.
- `packages/agent-core` owns the DI × Scope runtime and the business domains. The workspace ML domain covers analyses, experiments, training runs, evaluations, comparisons, and model versions.
- `packages/agent-core/src/workspace/datasets` owns dataset metadata and versions; `workspace/artifacts` owns artifact bytes and lineage; `workspace/execution` and execution targets own local/remote execution; `workspace/policy` gates mutations; `workspace/platformEvents` records platform events.
- `packages/agent-core/src/kosong` and `packages/kosong` are the model/provider abstraction layers. Model catalogs, provider connections, and platform model binding are configuration seams, not places for feature code to hard-code a provider.
- `packages/protocol` owns the REST/wire schemas used by the platform surface. `packages/kap-server/src/routes/v2/platform.ts` exposes datasets, artifacts, execution targets, and ML operations over the server boundary.
- `packages/transcript` owns the browser-safe transcript contract, idempotent operations, subscription granularity, and turn-cursor pagination. `packages/kap-server` adapts engine events to REST/WebSocket transcript state.
- `packages/minidb` provides the embedded durable store behind derived query and search read models: WAL, snapshots, index generations, full-text postings, bounded maintenance, and async reads.

## Workflow

1. Start with the request's data or model lifecycle. Use `rg` to find the public contract, service implementation, route/SDK surface, and existing tests before editing.
2. Read the nearest `AGENTS.md`. For `packages/agent-core`, follow the DI × Scope, persistence, error, flag, telemetry, and test boundaries. For `packages/minidb` and `packages/transcript`, preserve their package-specific storage and sequencing contracts.
3. Keep each change at the owning boundary:
   - ML behavior belongs in the workspace ML service and its collaborators.
   - Dataset and artifact metadata must stay separate from artifact bytes and dataset content.
   - Remote execution goes through execution targets and policy; local training goes through the explicit process bridge.
   - Model/provider behavior goes through the catalog/provider abstractions and model binding.
   - Search and read-model behavior belongs in the search/minidb layers, not in session business domains.
   - Transcript rendering state belongs in `packages/transcript`; server adapters should translate events rather than duplicate the contract.
4. Preserve the data invariants:
   - Validate external inputs at the protocol/service boundary with the existing schemas.
   - Keep request-idempotency and policy decisions intact for mutating ML operations.
   - Preserve artifact hashes, lineage, dataset version references, and explicit execution-target metadata.
   - Treat derived indexes as rebuildable. Keep an authoritative fallback and do not confuse the session query store with the global full-text search index.
   - Treat transcript operations as convergence data: all state-style operations are idempotent; `append` is offset-sensitive. Preserve batch sequencing and pagination cursors.
5. Keep telemetry privacy-safe. Do not add prompts, user content, absolute paths, credentials, or raw dataset contents to business-event properties. Register new telemetry events through the existing event registry.
6. For local ML execution, preserve the explicit `SPIDERBYTE_ML_TRAIN_COMMAND` boundary: direct process invocation, JSON request on stdin, JSON response on stdout, bounded output, timeout, and cancellation. Do not route it through a shell or silently add a Python dependency.

## Model and provider changes

Use the model catalog and provider registry to discover capabilities and metadata. Keep model IDs configurable and avoid embedding a specific provider in a domain service. When a model change affects the CLI picker, inspector, server catalog, aliases, or secondary-model behavior, trace and test each consumer rather than changing only the display layer.

For this repo's Codex workflow, the default is `gpt-5.3-codex` through `.codex/config.toml`. A user-selected model wins. Do not add a `model` key to `.codex-plugin/plugin.json`; the plugin ingestion contract rejects unsupported manifest fields.

## Verification

Run the narrowest relevant package tests first, then expand as needed:

```bash
pnpm --filter @spiderbyte/agent-core test
pnpm --filter @spiderbyte/kap-server test
pnpm --filter @spiderbyte/minidb test
pnpm --filter @spiderbyte/transcript test
git diff --check
```

For changes that cross the CLI/server/package boundary, also run the applicable typecheck or root verification script. For plugin-only changes, validate the manifest with:

```bash
python3 /Users/josiah/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/otis
```

Report which contract, service, and tests support the result. If a derived index or read model is degraded, make the fallback and recovery state explicit rather than treating an empty result as authoritative.
