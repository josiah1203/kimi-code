---
name: otis-retrieve-results
description: Use when a user wants result or artifact references from a completed SpiderByte workflow.
---

# Retrieve results

## Activation conditions

Activate for result lookup, output references, model metrics, or artifact
metadata after a Run.

## Required tools

Use `get_run`, `list_artifacts`, and `get_artifact`.

## Workflow

1. Start from exact workspace and Run IDs when available.
2. Read terminal Run state and output artifact references.
3. Resolve each artifact ID and return bounded metadata, hashes, sizes, and
   provenance when present.

## Confirmation and failure handling

Retrieval is read-only. Treat missing, expired, unauthorized, and truncated
results as distinct. The curated profile does not expose arbitrary raw content
download.

## Expected output

Return stable Run/artifact IDs, result status, media/type metadata, and whether
the result is complete or only a bounded reference.

## Examples

“Retrieve the result artifact references from Run `run_01`.”

## Privacy and security

Keep private artifact paths, secrets, and raw data out of model-visible output.
