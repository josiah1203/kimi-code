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

All skills require explicit confirmation before destructive, billable, or
compute-consuming actions. Hosted-only requests must call the unavailable
explanation tool and report the exact status instead of implying success.
