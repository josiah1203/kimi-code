---
name: otis-troubleshooting
description: Use when a SpiderByte workflow fails, times out, is unauthorized, crosses workspace scope, or reports an unavailable capability.
---

# Otis troubleshooting

## Activation conditions

Activate for MCP errors, missing tools, failed runs, denied policy decisions,
provider connection problems, stale artifacts, or hosted-feature questions.

## Required tools

`get_capabilities`, `get_run`, `list_execution_targets`, `list_artifacts`,
and `get_artifact`.

## Workflow

1. Classify the failure as input, auth, workspace scope, policy, budget,
   provider, execution, persistence, transport, or unavailable capability.
2. Inspect durable status and audit events before retrying.
3. Check local provider/target readiness without revealing secrets.
4. Retry only an idempotent operation and only after confirming the prior
   attempt’s state.
5. Give a concrete remediation and the exact remaining blocker.

## Confirmation

Ask before retrying a mutation, cancelling work, changing provider
configuration, or taking any action that could alter durable state.

## Failure handling

Never retry destructive operations automatically, bypass a policy gate, or
reinterpret `hosted-required`, `provider-unavailable`, or `enterprise-only` as
success.

## Expected output

Return category, evidence, safe remediation, whether data may have changed,
and whether the issue is implemented, local-only, unavailable, or planned.

## Example

“What capabilities are unavailable in this workspace, and why did my run stop?”

## Privacy and security

Use request IDs and durable event IDs for diagnosis. Do not include tokens,
stack traces, raw prompts, or private infrastructure details.
