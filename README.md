# SpiderByte Open Core

SpiderByte is a local, provider-neutral agent platform. The canonical
executable is `spyderbyte`, and the canonical runtime is SpiderByte Agent
Core.

This repository contains the self-hostable Open Core distribution: local
workspaces, sessions, runs, artifacts, policies, budgets, provider
connections, CLI/TUI, REST/WebSocket contracts, SDK, MCP, and ACP. It does
not contain hosted identity, billing, managed provider proxies, hosted
workers, Slack/Teams integrations, or Business/Enterprise deployment
services.

## Local quick start

Requirements: Node.js >= 24.15.0 and pnpm 10.33.0.

```sh
git clone https://github.com/SpiderByte/spiderbyte.git
cd spiderbyte
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @spiderbyte/cli run build
node apps/cli/dist/main.mjs --version
```

Run the interactive local CLI from a project directory:

```sh
spyderbyte
```

Configure a local or BYOK provider with `spyderbyte configure`. No hosted
SpiderByte credential is required for local mode. The browser UI source is
maintained outside this checkout; this repository provides the local server
API and does not ship an unreproducible generated frontend bundle.

## Development commands

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm run check:open-core
pnpm run check:branding
pnpm run verify:open-core-local
```

See [CONTRIBUTING.md](CONTRIBUTING.md), the [Open Core boundary](docs/architecture/OPEN_CORE_BOUNDARY.md), and the [release migration plan](docs/release/SPIDERBYTE_OPEN_CORE_MIGRATION_PLAN.md) for repository and release requirements.

## Packages

Publishable packages use the `@spiderbyte/*` scope. The main public packages
are `@spiderbyte/cli`, `@spiderbyte/agent-core`, `@spiderbyte/sdk`,
`@spiderbyte/client`, `@spiderbyte/protocol`, `@spiderbyte/kap-server`, and
the provider-neutral execution and persistence packages documented in
[`PACKAGE_RENAME_MAP.md`](docs/release/PACKAGE_RENAME_MAP.md).

## Otis plugin

[`plugins/otis`](plugins/otis) is the Codex/ChatGPT MCP plugin package. It
bundles reusable ML/data workflow skills and the headless local MCP adapter;
run `spyderbyte mcp` for stdio clients or use the authenticated `/mcp` endpoint
for an HTTPS development deployment. Hosted identity, billing, managed
compute, enterprise controls, and the optional UI remain explicitly outside
this Open Core checkout.

## License and security

SpiderByte Open Core is released under the [MIT License](LICENSE). See
[NOTICE](NOTICE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and
[SECURITY.md](SECURITY.md) for attribution and reporting guidance.
