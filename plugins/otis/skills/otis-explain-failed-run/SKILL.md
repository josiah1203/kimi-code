---
name: otis-explain-failed-run
description: Use when a user wants to understand why a SpiderByte Run failed or stopped.
---

# Explain a failed Run

## Activation conditions

Activate for failed, cancelled, timed-out, denied, or unavailable Run reports.

## Required tools

Use `get_run`, `get_capabilities`, and `get_artifact` for bounded output or
diagnostic metadata when the Run provides an artifact reference.

## Workflow

1. Inspect the authoritative Run state and status reason.
2. Classify the cause as input, authorization, policy, budget, provider,
   execution target, transport, persistence, or unknown.
3. Report what changed, what did not complete, and the safest next action.

## Confirmation and failure handling

Do not retry or cancel automatically. A timeout is not proof of failure; inspect
the Run first. Never expose stack traces, credentials, or private commands.

## Expected output

Return Run ID, terminal state, evidence, affected artifacts, confidence, and a
concrete remediation or unavailable classification.

## Examples

“Explain why Run `run_01` failed and whether it is safe to retry.”

## Privacy and security

Redact secrets and minimize error details. Preserve the daemon’s authorization
and audit boundary.
