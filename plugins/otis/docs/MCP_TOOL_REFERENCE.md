# MCP tool reference

The authoritative registration is
`packages/kap-server/src/mcp/server.ts`. Otis launches the `curated` profile;
the full `spiderbyte_*` inventory is a separate developer profile and is not a
plugin guarantee. Tool output is a bounded text summary plus a structured
envelope:

```json
{
  "request_id": "mcp_…",
  "status": "ok",
  "capability_status": "local-only",
  "workspace_id": "…",
  "data": {}
}
```

Errors use `status: "error"`, a stable `error.code`, and a redacted message.
Inputs are Zod-validated by the official MCP SDK. Workspace-scoped operations
require `workspace_id` or a configured local default. Responses never include
secret values, tokens, passwords, or authorization headers.

## Curated Otis tools

| Tool | Behavior | Confirmation / boundary |
| --- | --- | --- |
| `list_workspaces` | List bounded local workspace metadata | authenticated daemon/process scope |
| `list_projects` | List bounded local project metadata | authenticated daemon/process scope |
| `list_execution_targets` | List authorized local/customer-managed targets | workspace authorization; hosted compute is not implied |
| `create_run` | Create a durable Run envelope | idempotency key recommended; does not execute |
| `get_run` | Inspect a durable Run by stable IDs | workspace authorization |
| `cancel_run` | Cancel a durable Run | `confirmed: true`; audited |
| `list_artifacts` | List bounded artifact metadata | workspace authorization; no secret/content dump |
| `get_artifact` | Read bounded artifact metadata | workspace authorization |
| `profile_dataset` | Create a durable dataset profile | workspace and dataset policy |
| `run_sql_analysis` | Bounded read-only SQL over registered CSV/JSONL | max 1,000 rows; no arbitrary database route |
| `train_baseline_model` | Run the canonical dataset→profile→analysis→train→evaluate→model workflow | `confirmed: true`; policy/target checks; durable Run and artifacts; same-process retries coalesce |
| `get_capabilities` | Report implemented and unavailable boundaries | read-only |
| `request_approval` | Evaluate a governed action | policy service is authoritative; audited |

## Safety rules

- Every curated tool declares `readOnlyHint`, `openWorldHint`, and `destructiveHint`.
- Mutating operations carry an idempotency key where the canonical service
  supports request IDs.
- Closing sessions, cancelling work, resuming work, training, and model staging
  require `confirmed: true` when the operation is destructive or may consume
  compute.
- Policy and budget checks remain in canonical Workspace services; the MCP
  adapter does not bypass them.
- Workspace and session ownership is checked before service access.
- Each workspace call creates and completes/fails an audit event with a
  correlation/request ID.
- Curated structured results are capped at 64 KiB and text at 8,000 characters;
  large artifact content is not exposed by the curated profile. UI-only payloads are not required because
  there is no UI resource in this version.

## Unavailable hosted tool families

The following requested workflows are not registered as fake curated tools:
compute estimates, provider and profile catalogs for managed compute, hosted
job submit/inspect/cancel/logs/outputs, machine availability, hosted identity,
billing, team membership, provider OAuth, SSO/SCIM, enterprise retention, and
private deployment. Call `get_capabilities` for the explicit status; the full
developer profile additionally has `spiderbyte_explain_unavailable` for a
structured local alternative.
