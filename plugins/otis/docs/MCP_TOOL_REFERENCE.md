# MCP tool reference

The authoritative registration is
`packages/kap-server/src/mcp/server.ts`. Tool output is a bounded text summary
plus a structured envelope:

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

## Tool families

| Family | Tools | Status |
| --- | --- | --- |
| Discovery/account | `spiderbyte_capabilities`, `spiderbyte_account_status` | local status and explicit boundaries |
| Workspace/session | `spiderbyte_list_workspaces`, `spiderbyte_get_workspace`, `spiderbyte_register_workspace`, `spiderbyte_list_sessions`, `spiderbyte_create_session`, `spiderbyte_close_session` | local-only |
| Project/governance | `spiderbyte_list_organizations`, `spiderbyte_create_organization`, `spiderbyte_list_projects`, `spiderbyte_get_project`, `spiderbyte_create_project`, `spiderbyte_project_permissions` | local-only |
| Dataset | `spiderbyte_list_datasets`, `spiderbyte_get_dataset`, `spiderbyte_register_dataset`, `spiderbyte_profile_dataset`, `spiderbyte_query_dataset`, `spiderbyte_transform_dataset` | local-only |
| Analysis | `spiderbyte_analyze_dataset`, `spiderbyte_list_analyses`, `spiderbyte_get_analysis` | local-only; execution target policy still applies |
| Artifacts | `spiderbyte_list_artifacts`, `spiderbyte_get_artifact`, `spiderbyte_get_artifact_lineage`, `spiderbyte_get_artifact_content` | local-only; content is bounded |
| Runs | `spiderbyte_list_runs`, `spiderbyte_get_run`, `spiderbyte_create_run`, `spiderbyte_transition_run`, `spiderbyte_cancel_run`, `spiderbyte_resume_run`, `spiderbyte_retry_run`, `spiderbyte_rerun_run`, `spiderbyte_compare_runs` | local-only |
| Experiments/ML | `spiderbyte_list_experiments`, `spiderbyte_get_experiment`, `spiderbyte_create_experiment`, `spiderbyte_list_training_runs`, `spiderbyte_get_training_run`, `spiderbyte_start_training`, `spiderbyte_cancel_training`, `spiderbyte_list_evaluations`, `spiderbyte_get_evaluation`, `spiderbyte_compare_experiments`, `spiderbyte_list_models`, `spiderbyte_get_model`, `spiderbyte_register_model`, `spiderbyte_stage_model` | local-only or credential-required |
| Providers/targets | `spiderbyte_list_provider_connections`, `spiderbyte_get_provider_connection`, `spiderbyte_list_execution_targets`, `spiderbyte_get_execution_target` | local-only or credential-required |
| Governance | `spiderbyte_list_policies`, `spiderbyte_explain_policy`, `spiderbyte_request_approval`, `spiderbyte_approve_approval`, `spiderbyte_deny_approval`, `spiderbyte_get_budget_status`, `spiderbyte_get_usage`, `spiderbyte_list_events` | local-only |
| Search/fetch | `search`, `fetch` | local-only, stable `spiderbyte://` resources |
| Unavailable explanations | `spiderbyte_explain_unavailable` | explicit hosted/provider/enterprise statuses |

## Safety rules

- Every tool declares `readOnlyHint`, `openWorldHint`, and `destructiveHint`.
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
- Large artifact content is bounded; UI-only payloads are not required because
  there is no UI resource in this version.

## Unavailable hosted tool families

The following requested workflows are represented by
`spiderbyte_explain_unavailable`, not fake tools: compute estimates, provider
and profile catalogs for managed compute, hosted job submit/inspect/cancel/logs/
outputs, machine availability, hosted identity, billing, team membership,
provider OAuth, SSO/SCIM, enterprise retention, and private deployment.
