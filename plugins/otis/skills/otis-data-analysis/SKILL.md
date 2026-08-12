---
name: otis-data-analysis
description: Use when a user wants to profile, query, transform, compare, or explain a local dataset through SpiderByte.
---

# Otis data analysis

## Activation conditions

Activate for dataset quality, schema, profiling, bounded SQL/query, data
transformation, lineage, or analysis requests.

## Required tools

`spiderbyte_list_datasets`, `spiderbyte_get_dataset`,
`spiderbyte_register_dataset`, `spiderbyte_profile_dataset`,
`spiderbyte_query_dataset`, `spiderbyte_transform_dataset`,
`spiderbyte_analyze_dataset`, `search`, and `fetch`.

## Workflow

1. Identify the workspace and dataset without reading unrelated files.
2. Inspect metadata and versions before processing content.
3. Profile first; describe nulls, types, duplicates, ranges, and quality
   findings with bounded evidence.
4. Query or transform only within the dataset service’s supported formats and
   limits; preserve the source dataset.
5. Store or reference results as artifacts when the service returns them.

## Confirmation and failure handling

Confirm any transformation or export that creates durable output. Refuse
path-escaping, unsupported formats, unbounded content requests, or missing
workspace scope. If analysis is unavailable, report the exact service error and
offer a local bounded alternative.

## Expected output

Return dataset IDs/versions, concise quality findings, method/limits, and any
artifact or analysis identifiers. Distinguish local execution from provider or
hosted execution.

## Example

“Analyze this dataset and explain the main quality problems.”

## Privacy and security

Do not place raw rows, sensitive columns, credentials, or full dataset content
in model-visible summaries. Use bounded previews and authorized fetches only.
