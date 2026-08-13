---
name: otis-analyze-dataset
description: Use when a user wants a bounded quality analysis of a registered SpiderByte dataset.
---

# Analyze a dataset

## Activation conditions

Activate for dataset quality, schema, nulls, duplicates, distributions, or
profile requests.

## Required tools

Use `get_capabilities`, `profile_dataset`, `list_artifacts`, and
`get_artifact`.

## Workflow

1. Resolve the explicit workspace and registered dataset IDs.
2. Profile the selected dataset version before interpreting quality.
3. Return bounded findings, profile artifact ID, limits, and local capability
   status.
4. Retrieve only the artifact metadata needed to explain provenance.

## Confirmation and failure handling

Profiling is not destructive, but it creates a durable profile record. Stop on
missing scope, unsupported format, policy denial, or unavailable provider; do
not invent rows or quality findings.

## Expected output

Return `workspace_id`, `dataset_id`, version, profile artifact ID, bounded
quality findings, and the next safe action.

## Examples

“Profile dataset `dataset_01` in workspace `workspace_01` and summarize its
quality problems.”

## Privacy and security

Do not include raw rows, credentials, or sensitive columns in the response.
