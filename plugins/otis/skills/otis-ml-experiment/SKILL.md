---
name: otis-ml-experiment
description: Use when a user wants to define, run, evaluate, or compare local SpiderByte ML experiments and models.
---

# Otis ML experiments

## Activation conditions

Activate for experiment design, model comparison, training, evaluation,
prediction-oriented analysis, or model-stage requests.

## Required tools

`spiderbyte_list_experiments`, `spiderbyte_get_experiment`,
`spiderbyte_create_experiment`, `spiderbyte_start_training`,
`spiderbyte_cancel_training`, `spiderbyte_list_training_runs`,
`spiderbyte_list_evaluations`, `spiderbyte_compare_experiments`,
`spiderbyte_list_models`, `spiderbyte_register_model`,
`spiderbyte_stage_model`, and `spiderbyte_explain_policy`.

## Workflow

1. Inspect dataset versions, provider connections, execution targets, policy,
   and budget before creating an experiment.
2. Make the comparison dimensions and success metrics explicit.
3. Create the experiment with an idempotency key and preserve the source
   references.
4. Validate policy and use local training only when the configured command or
   target is available.
5. Inspect evaluations and compare completed experiments before staging a
   model.

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
