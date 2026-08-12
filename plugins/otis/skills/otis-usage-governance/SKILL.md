---
name: otis-usage-governance
description: Use when a user wants policy, approval, budget, usage, audit, entitlement, or environment-permission information.
---

# Otis usage and governance

## Activation conditions

Activate for approval requests, policy explanations, budget checks, usage
summaries, audit events, provider grants, or permission troubleshooting.

## Required tools

`spiderbyte_list_policies`, `spiderbyte_explain_policy`,
`spiderbyte_request_approval`, `spiderbyte_approve_approval`,
`spiderbyte_deny_approval`, `spiderbyte_get_budget_status`,
`spiderbyte_get_usage`, `spiderbyte_list_events`,
`spiderbyte_list_provider_connections`, `spiderbyte_account_status`, and
`spiderbyte_capabilities`.

## Workflow

1. Inspect current policy, budget, usage, and account/capability status.
2. Explain the exact rule or missing entitlement before requesting approval.
3. Use an explicit run/capability/action and idempotency key for approval work.
4. Require fresh confirmation for approve, deny, cancellation, or costly work.
5. Report the audit event or decision identifier.

## Confirmation

Require explicit user confirmation before approving, denying, cancelling, or
starting a costly or externally visible action. Reading policy, budget, usage,
and audit state is read-only.

## Failure handling

Fail closed on missing authentication, workspace, policy, budget, or
confirmation. Do not turn local usage into a commercial invoice or claim an
enterprise retention guarantee.

## Expected output

Return decision state, rule, budget/usage values, actor scope, event IDs, and
the next permitted action.

## Example

“Show my usage and remaining local compute allowance, then explain why this
run needs approval.”

## Privacy and security

Redact credentials and sensitive metadata. Treat audit events as durable
records, not as permission grants.
