---
name: otis-operational-workflows
description: Use when a user frames SpiderByte work as a research, campaign, business, or operational workflow spanning projects, datasets, experiments, and governed runs.
---

# Otis research and operational workflows

## Activation conditions

Activate for multi-step research, campaign analysis, business operations,
repeatable project workflows, or cross-run reporting.

## Required tools

`spiderbyte_list_projects`, `spiderbyte_get_project`,
`spiderbyte_project_permissions`, `spiderbyte_list_datasets`,
`spiderbyte_create_experiment`, `spiderbyte_create_run`,
`spiderbyte_get_run`, `spiderbyte_compare_experiments`, `search`,
`fetch`, and `spiderbyte_list_events`.

## Workflow

1. Translate the request into a local project, data, experiment, run, and
   reporting plan.
2. Reuse stable IDs and preserve dataset/model/version lineage.
3. Separate exploratory analysis from governed execution and approval.
4. Summarize evidence and unresolved decisions for the next operator.
5. Clearly label commercial campaign/team automation as unavailable unless an
   authenticated hosted server advertises it.

## Confirmation and failure handling

Confirm durable project/run mutations, exports, and actions that could spend
compute or change model state. Stop on missing permissions or ambiguous scope.

## Expected output

Return a compact plan, affected IDs, evidence sources, status values, approvals,
and a handoff-ready result.

## Example

“Create a project and prepare a governed research run comparing the last three
experiments.”

## Privacy and security

Keep reports to authorized metadata and bounded results. Do not infer business
entitlements, team membership, or campaign integrations from local records.
