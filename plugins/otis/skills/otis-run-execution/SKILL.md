---
name: otis-run-execution
description: Use when a user wants to plan, start, inspect, cancel, resume, retry, rerun, or compare a governed SpiderByte run.
---

# Otis run planning and execution

## Activation conditions

Activate for governed execution, run status, lifecycle transitions, retry,
resume, cancellation, or run comparison.

## Required tools

`spiderbyte_create_run`, `spiderbyte_transition_run`,
`spiderbyte_list_runs`, `spiderbyte_get_run`, `spiderbyte_compare_runs`,
`spiderbyte_list_events`, `spiderbyte_request_approval`,
`spiderbyte_get_budget_status`, and `spiderbyte_list_execution_targets`.

## Workflow

1. Resolve workspace and session scope.
2. Inspect policy, budget, execution targets, and recent runs.
3. Create an idempotent run envelope with an explicit plan and target.
4. Transition through the service’s validated lifecycle; do not skip approval
   or policy states.
5. Inspect run status/events and compare only compatible runs.

## Confirmation and failure handling

Require confirmation before cancellation, retries that may repeat work, or any
billable/compute-consuming action. A timeout is not proof of failure; inspect
the run before retrying. Never mark a run successful from a client-side guess.

## Expected output

Return run/session/workspace IDs, lifecycle state, policy and budget evidence,
execution target, outputs, and next safe action.

## Example

“Plan this analysis, show me the approval gate, then run it locally.”

## Privacy and security

Use idempotency keys for mutations. Keep command details and environment
secrets out of model-visible output. Server-side policy and authorization are
authoritative.
