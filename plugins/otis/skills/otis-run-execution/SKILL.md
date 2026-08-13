---
name: otis-run-execution
description: Use when a user wants to plan, start, inspect, cancel, resume, retry, rerun, or compare a governed SpiderByte run.
---

# Otis run planning and execution

## Activation conditions

Activate for governed execution, run status, lifecycle transitions, retry,
resume, cancellation, or run comparison.

## Required tools

`get_capabilities`, `list_execution_targets`, `create_run`, `get_run`,
`cancel_run`, and `request_approval`.
The curated surface does not expose arbitrary lifecycle transitions, retries,
or event browsing; use the full profile or local CLI when those operations are
explicitly available.

## Workflow

1. Resolve workspace and session scope.
2. Inspect policy, budget, execution targets, and recent runs.
3. Create an idempotent Run envelope with an explicit plan and target.
4. Use `request_approval` before restricted work; do not infer approval from a
   previous response.
5. Inspect the Run by its returned stable ID and never infer success from a
   client-side timeout.

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
