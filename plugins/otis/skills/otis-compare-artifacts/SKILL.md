---
name: otis-compare-artifacts
description: Use when a user wants to compare two or more SpiderByte result artifacts.
---

# Compare artifacts

## Activation conditions

Activate for result comparison, metric comparison, provenance comparison, or
regression investigation.

## Required tools

Use `list_artifacts` and `get_artifact`; use `get_run` when artifacts came from
Runs.

## Workflow

1. Resolve all artifact IDs in one authorized workspace.
2. Retrieve bounded metadata and compare only fields the daemon returned.
3. State when content, lineage, or a semantic comparison is unavailable in the
   curated profile.

## Confirmation and failure handling

Comparison is read-only. Do not claim a metric regression from names, hashes,
or sizes alone. Use the full local profile or canonical analysis service when
the required comparison data is not exposed here.

## Expected output

Return compared IDs, common metadata, differences, provenance evidence, and
any unavailable comparison dimension.

## Examples

“Compare artifacts `artifact_01` and `artifact_02` and identify any metadata
differences.”

## Privacy and security

Do not fetch or reproduce private artifact content unless an authorized local
surface explicitly returns a bounded result.
