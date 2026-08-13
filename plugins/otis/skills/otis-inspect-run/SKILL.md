---
name: otis-inspect-run
description: Use when a user wants the current or completed state of a SpiderByte Run.
---

# Inspect a completed Run

## Activation conditions

Activate for Run status, outputs, lifecycle state, target, policy references,
or previous execution questions.

## Required tools

Use `get_run`, and use `list_artifacts` or `get_artifact` for returned outputs.

## Workflow

1. Require the exact workspace, session, and Run IDs.
2. Read the authoritative Run state from the daemon.
3. If terminal, inspect bounded output artifact metadata.
4. Distinguish queued, running, succeeded, failed, and cancelled states.

## Confirmation and failure handling

Inspection is read-only. Do not retry, cancel, or mark a Run complete from a
client-side timeout or stale response.

## Expected output

Return stable IDs, status timestamps, target, policy references, failure reason,
and output artifact references.

## Examples

“Inspect Run `run_01` in session `session_01` and tell me whether it completed.”

## Privacy and security

Redact command details, credentials, private paths, and sensitive metadata.
