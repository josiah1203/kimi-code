---
name: otis-run-sql-analysis
description: Use when a user wants governed read-only SQL over a registered SpiderByte CSV or JSONL dataset.
---

# Run governed SQL analysis

## Activation conditions

Activate for bounded SQL summaries, filters, aggregates, or previews over a
registered local dataset.

## Required tools

Use `run_sql_analysis`, and use `get_capabilities` first when the execution
boundary is unclear.

## Workflow

1. Confirm workspace, dataset, version, and the intended question.
2. Use a read-only query with an explicit bounded row limit of at most 1,000.
3. Explain the query, limit, result status, and any truncation.

## Confirmation and failure handling

Do not use arbitrary database connections, shell commands, write statements,
or unbounded queries. Stop on malformed SQL, policy denial, scope failure, or
unsupported format.

## Expected output

Return the stable dataset/version IDs, query purpose, bounded rows or metrics,
limit, and local-only status.

## Examples

“Count rows by status in dataset `dataset_01`, returning no more than 100 rows.”

## Privacy and security

Avoid selecting sensitive columns. Do not place full raw datasets in model
context or logs.
