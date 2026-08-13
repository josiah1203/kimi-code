# Otis submission and review artifacts

Status: prepared, not submitted.

## Listing metadata

- Name: Otis
- Slug: `otis`
- Category: Data & ML
- Description: Repo-aware SpiderByte tools, runtime, ML, and data workflows
  for Codex and MCP-compatible clients.
- Architecture: skills plus headless MCP server; optional UI is not included.
- MCP server: `spiderbyte`
- Local entry point: `spyderbyte mcp --profile curated`
- Production endpoint: **required, not supplied by this repository**
- Privacy policy: **required, not supplied by this repository**
- Support contact/URL: **required, not supplied by this repository**
- Icon: **required for listing; create a 1:1 production asset and verify the
  platform’s current size/format requirements before submission**
- Screenshots: **required for listing; capture the local developer-mode tool
  flow and structured run/dataset/artifact results after a stable hosted test
  environment exists**

The manifest intentionally omits unsupported or placeholder privacy/support
URLs. A fake URL would make the package appear more complete than it is.

## Starter prompts

1. “Analyze this dataset and explain the main quality problems.”
2. “Create an experiment comparing these two models.”
3. “Plan a governed local run and show me what requires approval.”
4. “Show me the results and artifact lineage from my previous run.”
5. “What capabilities are unavailable in this workspace?”

## Positive test cases

| Case | Request | Expected result |
| --- | --- | --- |
| P1 | Analyze a registered local dataset | Uses `profile_dataset` or `run_sql_analysis`; returns bounded structured data and local status. |
| P2 | Launch a baseline model | Uses `train_baseline_model` only after explicit confirmation; returns durable Run and artifact IDs. |
| P3 | Plan and inspect a run | Uses `create_run` and `get_run`, with workspace authorization and stable IDs. |
| P4 | Inspect prior results | Uses `list_artifacts` and `get_artifact` with bounded metadata. |
| P5 | Request restricted action approval | Uses `request_approval`; policy and audit remain daemon-side. |

## Negative test cases

| Case | Request | Expected result |
| --- | --- | --- |
| N1 | Submit a hosted job without a hosted service | Returns `hosted-required` through `get_capabilities`/daemon status; no job is created. |
| N2 | Use a Run, artifact, or target from another workspace | Returns a workspace-scope error; no record is disclosed. |
| N3 | Cancel a Run or launch baseline training without confirmation | Returns `confirmation_required`; the operation is not executed. |

## Review checklist

- [x] `.codex-plugin/plugin.json` is present and validator-compatible.
- [x] `.mcp.json` contains a local stdio configuration without secrets.
- [x] Skills include activation, tools, workflow, confirmation, failure,
  expected output, examples, and privacy constraints.
- [x] Headless tool results work without a UI.
- [x] Local HTTP MCP uses the existing bearer/auth boundary.
- [x] Hosted and enterprise gaps are explicit.
- [ ] Production HTTPS MCP URL.
- [ ] Privacy policy URL.
- [ ] Support contact/URL.
- [ ] Icon and production screenshots.
- [ ] Organization verification and Apps Management permissions.
- [ ] Production OAuth/tenant/billing/hosted-compute review where applicable.
- [ ] Public submission and approval.

## Organization verification checklist

- [ ] Confirm the publishing organization and authorized human owner.
- [ ] Verify the GitHub repository ownership and production domain ownership.
- [ ] Provide the production support contact and escalation owner.
- [ ] Confirm privacy-policy jurisdiction, data-controller language, and data
  deletion contact.
- [ ] Review all external provider, tunnel, hosting, and dependency terms.

## Apps Management permissions checklist

- [ ] Confirm the account is permitted to create/manage the MCP application.
- [ ] Register only the production HTTPS `/mcp` origin and exact domains.
- [ ] Do not request UI, domain, or OAuth permissions that the package does
  not use.
- [ ] If a UI is added later, register its exact resource/CSP metadata and
  re-run the UI security review.
- [ ] Verify tool descriptions, annotations, confirmation behavior, and
  negative cases in the target ChatGPT environment.

## Submission gate

Developer-mode testing may proceed after local validation. Public submission is
blocked until the unchecked metadata, deployment, organization, and review
items are supplied. The repository does not submit, publish, or claim approval.
