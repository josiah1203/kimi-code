---
name: otis-artifact-results
description: Use when a user wants to inspect, trace, retrieve, compare, or export SpiderByte results and artifacts.
---

# Otis results and artifacts

## Activation conditions

Activate for result inspection, artifact content, lineage, previous-run
lookups, reproducibility, or bounded export requests.

## Required tools

`list_artifacts`, `get_artifact`, and `get_run`.
The curated surface returns bounded metadata and stable IDs; raw content,
lineage, search, and fetch remain local/full-profile capabilities.

## Workflow

1. Search for stable IDs and confirm workspace scope.
2. Inspect metadata and lineage before requesting bytes.
3. Retrieve content only when authorized and within the bounded MCP limit.
4. Explain provenance, source runs, dataset versions, and truncation clearly.
5. Export through a canonical service when one exists; do not copy private
   files into arbitrary locations.

## Confirmation and failure handling

Confirm exports or large/billable retrievals. Treat a missing artifact,
expired artifact, unauthorized content, and truncated content as distinct
outcomes.

## Expected output

Return stable artifact IDs, media type, size/hash when available, lineage,
authorization status, and whether content is complete or bounded.

## Example

“Show me the results and lineage from my previous run.”

## Privacy and security

Never expose secrets embedded in metadata or artifact paths. Do not bypass
artifact authorization or claim that a bounded response is the full artifact.
