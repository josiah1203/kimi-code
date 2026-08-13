---
name: otis-request-approval
description: Use when a user wants a SpiderByte policy decision before a restricted action.
---

# Request approval

## Activation conditions

Activate for restricted shell, filesystem, network, credentials, dataset,
connector, model, cloud, serving, or deployment actions.

## Required tools

Use `get_capabilities` and `request_approval` with an explicit workspace,
capability, action, and optional Run ID.

## Workflow

1. Describe the exact action and requested scope.
2. Submit one idempotent approval request to the customer-controlled daemon.
3. Report allow, deny, or approval-required exactly as returned.
4. Do not treat a request as approval; execution must re-evaluate policy.

## Confirmation and failure handling

Requesting a decision is not permission to execute. Never bypass a denial,
reuse an expired decision, or approve/deny on behalf of a user without a
separate authoritative workflow.

## Expected output

Return decision ID, state, capability, reason, Run ID, expiry/revocation data
when present, and the next permitted action.

## Examples

“Request approval to use the customer-managed GPU target for Run `run_01`.”

## Privacy and security

Do not include credentials or sensitive payloads in the action description.
