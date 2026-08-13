---
name: otis-ml-experiment
description: Use when a user wants to define, run, evaluate, or compare local SpiderByte ML experiments and models.
---

# Otis ML experiments

## Activation conditions

Activate for experiment design, model comparison, training, evaluation,
prediction-oriented analysis, or model-stage requests.

## Required tools

`get_capabilities`, `list_execution_targets`, `train_baseline_model`,
`get_run`, `list_artifacts`, `get_artifact`, and `request_approval`.
The curated baseline tool is the supported end-to-end ML entry point; detailed
experiment/model management remains a full-profile or local service workflow.

## Workflow

1. Inspect dataset versions, provider connections, execution targets, policy,
   and budget before creating an experiment.
2. Make the comparison dimensions and success metrics explicit.
3. Request explicit confirmation before `train_baseline_model`, preserve the
   returned Run and artifact IDs, and use the selected execution target only
   when it is authorized and ready.
4. Inspect the completed Run and artifacts before reporting metrics or model
   readiness.

## Confirmation and failure handling

Require explicit confirmation before training, cancellation, or model-stage
changes. Do not silently retry a failed or costly training run. Report missing
provider credentials, unavailable adapters, policy denials, and timeout state
separately.

## Expected output

Return experiment/training/evaluation/model IDs, execution mode, metrics,
policy decision, and reproducibility references.

## Example

“Create an experiment comparing these two models and evaluate the completed
runs.”

## Privacy and security

Keep provider credentials opaque. Do not invent a hosted GPU or claim a model
was trained when the local execution service did not return a completed result.
