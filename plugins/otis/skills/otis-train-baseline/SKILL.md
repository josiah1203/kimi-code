---
name: otis-train-baseline
description: Use when a user wants a governed local baseline ML workflow from a registered dataset.
---

# Launch a baseline ML workflow

## Activation conditions

Activate for a first classification or regression model, baseline metrics, or
dataset-to-model workflow.

## Required tools

Use `get_capabilities`, `list_execution_targets`, `request_approval`, and
`train_baseline_model`.

## Workflow

1. Inspect capability status and authorized execution targets.
2. Make dataset, target, features, task, metrics, and execution target
   explicit.
3. Request or inspect the required policy decision.
4. Ask for explicit user confirmation before calling
   `train_baseline_model` with `confirmed: true`.
5. Return the durable Run, model, evaluation, and artifact IDs only after the
   daemon reports success.

## Confirmation and failure handling

Never infer confirmation, hosted compute, provider availability, or model
success. A timeout requires `get_run` before any retry. Stop on policy, budget,
provider, or execution-target failure.

## Expected output

Return task configuration, execution mode, Run ID, metrics, evaluation/model
IDs, artifact IDs, and reproducibility limitations.

## Examples

“Train a confirmed local classification baseline for `target` using these
features and return the resulting Run and artifact IDs.”

## Privacy and security

Keep credentials and raw training data out of summaries. Customer-managed
targets remain subject to daemon authorization.
