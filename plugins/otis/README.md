# Otis

Otis is the SpiderByte plugin for Codex and MCP-compatible clients. It
combines reusable workflow skills with a headless MCP server backed by
SpiderByte’s canonical local App, Workspace, and Session services.

This package is intentionally honest about the boundary: local workspaces,
runs, artifacts, datasets, ML records, provider connections, policy, budget,
usage, and audit events are implemented. Hosted identity, tenancy, billing,
managed compute, provider OAuth, enterprise administration, and an MCP Apps UI
are not implemented in this checkout. The intended remote mode is a
customer-controlled SpiderByte daemon; a SpiderByte-operated hosted control
plane is optional future scope. Commercial access is intended to be seat-based
and must not be inferred from the local plugin package.

## Package classification

- Plugin name: `otis`
- Display name: Otis
- MCP server: `spiderbyte`
- Local stdio command: `spyderbyte mcp --profile curated`
- HTTP endpoint: `/mcp`
- MCP transport: official 2026-07-28 stateless HTTP and stdio; stateless legacy
  fallback is retained for older clients
- Architecture: skills plus MCP server, with no required UI
- Default repository model: `gpt-5.3-codex` in `.codex/config.toml`

## Local quick start

From a Node `>=24.15.0` / pnpm `10.33.0` checkout:

```bash
pnpm install
pnpm --filter @spiderbyte/protocol build
pnpm --filter @spiderbyte/kap-server build
pnpm --filter @spiderbyte/cli build
python3 /Users/josiah/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/otis
```

The plugin’s bundled `.mcp.json` launches the curated semantic surface:

```text
spyderbyte mcp --profile curated
```

That process uses MCP stdio and never opens a network listener. Workspace
tools require `workspace_id`, unless `SPIDERBYTE_MCP_WORKSPACE_ID` or
`spyderbyte mcp --workspace <id> --profile curated` supplies a local default.
The full `spiderbyte_*` inventory remains a developer-facing profile and is not
the Otis plugin contract.

## Documentation

- [Codex CLI and IDE setup](./docs/CODEX_SETUP.md)
- [ChatGPT Developer Mode setup](./docs/CHATGPT_SETUP.md)
- [Local development](./docs/DEVELOPMENT.md)
- [MCP tool reference](./docs/MCP_TOOL_REFERENCE.md)
- [Skill reference](./docs/SKILL_REFERENCE.md)
- [Security and data flow](./docs/SECURITY_AND_DATA_FLOW.md)
- [Hosted boundary](./docs/HOSTED_DEPLOYMENT.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)
- [Submission/review artifacts](./submission/REVIEW_ARTIFACTS.md)
- [Repository architecture authority](../../docs/architecture/SPIDERBYTE_OTIS_PLUGIN_ARCHITECTURE.md)

## Public-release status

Otis is ready for local developer-mode testing after the focused validation
commands in the development guide. It is not ready for public plugin
submission until a production HTTPS MCP URL, privacy policy, support contact,
organization verification, final security/dependency/SBOM checks, and either
a verified customer-controlled deployment or a separately supplied hosted
service exist. No public submission is performed by this repository change.
