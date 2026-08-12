---
name: otis-spiderbyte
description: Use when working anywhere in the SpiderByte repository, especially the agent tool registry, governed platform tools, plugins and MCP, CLI/server/SDK surfaces, or cross-package architecture.
---

# Otis: SpiderByte tools and repository architecture

Otis is the repository-aware layer for SpiderByte. It helps Codex understand
the actual engine tools, platform contracts, public boundaries, and the code
that owns each behavior. Use this skill alongside `otis-ml-data` when a task
touches both the tool/runtime surface and ML or data.

## Activation conditions

Activate for repository architecture, runtime, tool registry, plugin, MCP,
CLI, server, SDK, protocol, provider, persistence, or open-core boundary work.

## Required MCP tools

Use `spiderbyte_capabilities` first when the task may cross a local/hosted
boundary. Then use the narrowest applicable `search`, `fetch`, workspace,
project, Run, artifact, provider, policy, or event tool. Native engine work
inside the repository still uses the canonical service and platform-tool
contracts described below.

## Workflow

Trace the public contract, owning service, persistence boundary, adapter, and
tests before editing. Keep user-goal MCP tools separate from internal engine
tool contributions, and report an unavailable capability instead of wrapping a
missing hosted service.

## Confirmation

Ask before destructive, compute-consuming, credential-related, or externally
visible changes. Honor server-side confirmation, policy, and workspace checks.

## Failure handling

Stop on scope, policy, credential, or provider failures. Inspect the capability
report or `spiderbyte_explain_unavailable`; do not bypass a failed check with a
direct database, shell, or arbitrary HTTP call.

## Expected output

Return the owning package/service, capability status, relevant identifiers,
security boundary, and focused validation evidence. Distinguish implemented,
local-only, hosted-required, credential-required, provider-unavailable,
enterprise-only, disabled, and planned states.

## Examples

- “Trace this MCP tool from `tools/list` to the Workspace service and test.”
- “Explain whether hosted compute exists in this checkout.”

## Privacy

Do not expose credentials, tokens, raw prompts, private dataset contents, or
unbounded artifact bytes. Preserve redaction, workspace isolation, audit, and
request-idempotency invariants.

## What SpiderByte actually provides

### Core agent tools

The canonical built-in tool contributions live under
`packages/agent-core/src/agent/tools`. The current engine tool names are:

- `Read`, `Write`, `Edit`, `Glob`, `Grep`, and `Bash` for governed workspace and
  process interaction.
- `FetchURL`, `WebSearch`, and `ReadMediaFile` for network or media work.
- `Skill` and `SelectTools` for loading instructions and managing the active
  tool set.
- `AskUserQuestion` for structured clarification.
- `Agent` and `AgentSwarm` for delegated or parallel agent work.
- `TaskList`, `TaskOutput`, and `TaskStop` for background task management.
- `TodoList` for short-lived work tracking.
- `CronCreate`, `CronList`, and `CronDelete` for scheduled work.
- `CreateGoal`, `GetGoal`, `UpdateGoal`, and `SetGoalBudget` for durable goal
  lifecycle and budgets.

The tool registry is per-agent and is assembled through DI contributions. Do
not treat a filename or a class as the public contract by itself. Trace the
tool contribution, activation predicate, executable implementation, permission
policy, and tests before changing behavior.

### Governed platform tools

When the `platform_services` feature flag is enabled and the complete platform
service graph is present, `packages/agent-core/src/agent/tools/platform`
registers these model-facing tools:

- `Dataset`: `list`, `inspect`, `register`, `version`, `profile`, `query`, and
  `transform` for CSV/JSONL datasets and bounded SQL operations.
- `Run`: `create`, `list`, `inspect`, `cancel`, `retry`, `rerun`, `resume`, and
  `fork` for durable workflow execution.
- `Provider`: `list`, `add`, `revoke`, `validate`, `discover_models`,
  `describe_model`, `select`, and `clear` for provider connections and model
  binding.
- `Artifact`: `list`, `from_run`, `inspect`, `lineage`, and `download` for
  content-addressed outputs and provenance.
- `Governance`: `list`, `pending`, `explain`, `evaluate`, `approve`, and `deny`
  for policy decisions.
- `Resource`: `list`, `inspect`, `create`, `update`, `execute`, and `archive`.
- `ExecutionTarget`: `list`, `inspect`, `register`, `update`, `mark_ready`,
  `disable`, `acquire_lease`, and `release_lease`.
- `Automation`: `list`, `inspect`, `history`, `create`, `fire`, `pause`, and
  `resume`.
- `ML`: `list_analyses`, `inspect_analysis`, `baseline_workflow`, `analyze`,
  `list_experiments`, `inspect_experiment`, `create_experiment`,
  `validate_experiment`, `list_training_runs`, `inspect_training_run`, `train`,
  `cancel_training`, `list_evaluations`, `inspect_evaluation`, `evaluate`,
  `compare`, `list_models`, `inspect_model`, `register_model`, and `stage_model`.
- `Pipeline`: `list`, `inspect`, `create`, `list_runs`, `inspect_run`, `run`,
  and `cancel`.
- `Serving`: `list_packages`, `inspect_package`, `package`, `list_endpoints`,
  `inspect_endpoint`, `deploy`, `pause`, `resume`, `archive`, and `rollback`.

These are not generic CRUD shortcuts. The implementations create or update
durable records, preserve request idempotency, attach policy decisions, record
Runs where appropriate, keep secrets opaque, and project large results into
model-readable summaries. Prefer these tools and their service contracts over
direct file or database manipulation.

For ML specifically:

- Dataset metadata and versions belong to `workspace/datasets`.
- Artifact bytes and lineage belong to `workspace/artifacts`.
- Experiment, training, evaluation, comparison, and model-version metadata
  belong to `workspace/ml`.
- Local execution crosses the explicit `SPIDERBYTE_ML_TRAIN_COMMAND` process
  boundary with JSON on stdin/stdout, bounded output, timeout, and cancellation.
- Remote work goes through execution targets and policy; do not add an implicit
  Python, shell, notebook, or provider dependency.

## The plugin and MCP boundary

SpiderByte has two plugin concepts that must not be conflated:

- A Codex plugin uses `.codex-plugin/plugin.json` and can contribute skills,
  optional Apps, and optional MCP servers.
- A SpiderByte plugin uses `spiderbyte.plugin.json` or
  `.spiderbyte-plugin/plugin.json`. Its runtime contributions are handled by
  `packages/agent-core/src/app/plugin` and can include skills, MCP servers,
  hooks, and plugin commands.

The SpiderByte runtime has an MCP client and connection manager for outbound
connections. It now also exposes a standalone, headless MCP adapter from
`packages/kap-server/src/mcp`: `spyderbyte mcp` serves stdio for local Codex
workflows, while `spyderbyte web` serves authenticated Streamable HTTP at
`/mcp`. The adapter resolves canonical App/Workspace/Session services rather
than reaching into MiniDB or duplicating business rules. Every workspace call
records an `mcp_invocation` audit event and enforces workspace scope, existing
policy services, confirmation gates, bounded outputs, and secret redaction.

Otis can therefore expose the supported platform workflows through MCP, but it
must still distinguish the two tool surfaces:

- Native engine tools such as `Dataset`, `Run`, `Provider`, `Artifact`, `ML`,
  `Governance`, `ExecutionTarget`, `Pipeline`, and `Serving` remain internal
  agent contributions. Use their canonical service contracts and platform
  tools when working inside the repository.
- MCP tools are stable user-goal adapters such as
  `spiderbyte_profile_dataset`, `spiderbyte_create_experiment`,
  `spiderbyte_compare_runs`, `spiderbyte_get_artifact_content`, `search`, and
  `fetch`. They are headless and intentionally return local capability status.

Hosted identity, billing, managed compute, provider OAuth, SSO/SCIM, and
enterprise controls are not implemented in Open Core. Otis must call
`spiderbyte_capabilities` or `spiderbyte_explain_unavailable` before presenting
those workflows as available. It must never turn an unavailable hosted tool
into a generic HTTP or shell wrapper that bypasses policy, Run, approval, or
audit boundaries.

## Public surfaces to trace

- `packages/agent-core`: canonical DI × Scope engine, tool registry, plugins,
  policy, sessions, workspace services, and ML/data domains.
- `packages/protocol`: wire schemas and lifecycle contracts for platform,
  datasets, artifacts, execution, serving, and ML.
- `packages/sdk`: `SpiderByteHarness` and the public platform facade; use this
  for in-process host integrations rather than reaching into DI internals.
- `packages/client`: the contract-driven client facade, including global plugin
  and MCP management and session-scoped operations.
- `packages/kap-server`: local REST/WebSocket server. API v1 covers sessions,
  prompts, transcript, search, tools, MCP, files, and workspace operations. API
  v2 adds the grouped platform surface under
  `/workspaces/:workspace_id/platform/...` for connections, policy, resources,
  datasets, artifacts, ML, pipelines, serving, execution targets,
  automations, usage, budgets, and events.
- `apps/cli`: the canonical CLI/TUI host. Useful command entry points include
  `spyderbyte run`, `spyderbyte web`, `spyderbyte provider`,
  `spyderbyte configure`, `spyderbyte connections`, `spyderbyte usage`,
  `spyderbyte plugins`, `spyderbyte organization`, `spyderbyte project`, and
  `spyderbyte workspace`.
- `packages/kosong`: provider-neutral LLM abstraction and model/provider
  implementations.
- `packages/kaos`: process, filesystem, and execution environment abstractions.
- `packages/transcript`: the sole owner of the browser-safe transcript contract,
  idempotent operations, subscription granularity, and pagination cursors.
- `packages/minidb`: embedded WAL/snapshot document store and rebuildable
  derived search/index layer.
- `packages/telemetry`: privacy-safe client telemetry infrastructure.
- `apps/inspect`: debug inspector for the kap-server RPC surface.

## Repository workflow

1. Read the nearest `AGENTS.md` before editing. Treat code and schemas as the
   source of truth; use Markdown only when the code points to it as a contract.
2. Start from the public contract or tool schema, then trace the service,
   persistence owner, route/SDK adapter, and existing tests.
3. Keep boundaries intact: service-layer persistence instead of direct fs/SQL,
   protocol validation at external edges, policy for governed actions, and
   derived search indexes separate from authoritative session state.
4. For transcript changes, preserve batch sequencing and the distinction between
   idempotent state operations and offset-sensitive append operations.
5. For provider/model changes, trace the model catalog, provider registry,
   model binding, CLI picker, server catalog, and secondary-model consumers.
6. Verify narrowly first, then expand as the change crosses package boundaries:

   ```bash
   pnpm --filter @spiderbyte/agent-core test
   pnpm --filter @spiderbyte/kap-server test
   pnpm --filter @spiderbyte/minidb test
   pnpm --filter @spiderbyte/transcript test
   git diff --check
   ```

## Codex model selection

Otis selects `gpt-5.3-codex` through the repo-scoped `.codex/config.toml`.
That setting controls Codex; it does not rewrite SpiderByte's provider config.
Honor an explicit user or session model override. SpiderByte's own runtime
model remains governed by its `default_model`/provider configuration and model
catalog.
