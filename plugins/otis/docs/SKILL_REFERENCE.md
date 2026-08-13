# Otis skill reference

Each skill complements MCP tools with workflow guidance. Skills do not replace
server-side validation, authorization, policy, billing, or tenant checks.

| Skill | Activation |
| --- | --- |
| `otis-spiderbyte` | Any repo-aware SpiderByte runtime, SDK, MCP, provider, or persistence task |
| `otis-ml-data` | ML, dataset, experiment, artifact, evaluation, or analytics work |
| `otis-project-setup` | Creating or locating local organizations, projects, and workspaces |
| `otis-data-analysis` | Profiling, querying, transforming, or explaining dataset quality |
| `otis-ml-experiment` | Defining experiments, training, evaluating, comparing, or registering models |
| `otis-run-execution` | Planning, starting, inspecting, cancelling, retrying, or resuming Runs |
| `otis-artifact-results` | Inspecting results, artifact content, lineage, search, and fetch resources |
| `otis-hosted-compute` | A user asks for hosted compute, machines, estimates, or managed jobs; explains the boundary |
| `otis-usage-governance` | Policies, approvals, budgets, usage, provider credentials, or audit events |
| `otis-troubleshooting` | A capability is unavailable, a tool fails, or local/hosted setup is unclear |
| `otis-operational-workflows` | Campaign, research, business, or operational workflows that can be expressed through local projects, Runs, artifacts, and governance |
| `otis-analyze-dataset` | A bounded quality analysis of a registered dataset |
| `otis-run-sql-analysis` | Governed read-only SQL over a registered CSV or JSONL dataset |
| `otis-train-baseline` | A confirmed local baseline ML workflow |
| `otis-inspect-run` | Inspecting a completed or active Run |
| `otis-compare-artifacts` | Comparing bounded artifact metadata and provenance |
| `otis-retrieve-results` | Retrieving Run output and artifact references |
| `otis-explain-failed-run` | Explaining failed, cancelled, or unavailable Runs |
| `otis-request-approval` | Requesting a policy decision for a restricted action |

All skills require explicit confirmation before destructive, billable, or
compute-consuming actions. Hosted-only requests must call `get_capabilities`
and report the exact status instead of implying success.
