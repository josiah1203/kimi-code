---
name: otis-hosted-compute
description: Use when a user asks for hosted compute, managed machines, provider availability, job submission, logs, outputs, or cost estimates.
---

# Otis hosted compute

## Activation conditions

Activate for GPU/CPU estimates, hosted job submission, managed machine
availability, hosted logs/outputs, or provider orchestration.

## Required tools

Always call `spiderbyte_capabilities`, `spiderbyte_account_status`, and
`spiderbyte_explain_unavailable` first. If a future authenticated commercial
MCP server advertises hosted tools, use only the exact advertised schemas.

## Workflow

1. Report that this checkout exposes local/customer-managed targets only.
2. Explain the missing hosted identity, entitlement, budget, provider, and
   worker boundary with `spiderbyte_explain_unavailable`.
3. Offer a local execution target after inspecting policy and budget.
4. Do not submit a fake job, estimate invented prices, or return fabricated
   machine availability.

## Confirmation and failure handling

Hosted actions would require authenticated workspace context, entitlement,
budget checks, provider availability, timeout, cancellation, and retention
policy. If any are absent, stop and report `hosted-required`.

## Expected output

Return exact capability status, missing prerequisites, local alternative, and
the deployment/credential boundary needed to continue.

## Example

“Estimate hosted compute cost before submitting this run.”

## Privacy and security

Never ask the model to paste tokens, payment data, or cloud credentials into a
tool argument. Hosted compute is not implemented in Open Core.
