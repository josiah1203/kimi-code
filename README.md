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

Provider CLIs can be inspected or smoke-tested only when explicitly
configured through `SPYDERBYTE_PROVIDER_CLI_CONFIG`; the CLI never guesses a
provider command or scrapes terminal output:

```sh
spyderbyte providers
spyderbyte provider detect
spyderbyte provider test YOUR_PROVIDER_ID --model YOUR_MODEL
spyderbyte capabilities
```

The variable contains a JSON array of command definitions with an executable,
provider-specific argv arrays, and JSONL output settings. See
[`SPIDERBYTE_PRODUCT_AUTHORITY.md`](docs/architecture/SPIDERBYTE_PRODUCT_AUTHORITY.md)
and `spyderbyte provider --help` for the supported boundary.

## Development commands

```sh
pnpm run bootstrap:clean-checkout
pnpm run smoke:local
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm run check:open-core
pnpm run check:branding
pnpm run check:package-consistency
pnpm run check:docs-consistency
pnpm run verify:open-core-local
```

See [CONTRIBUTING.md](CONTRIBUTING.md), the [product authority](docs/architecture/SPIDERBYTE_PRODUCT_AUTHORITY.md), the [self-hosted operations guide](docs/release/SPIDERBYTE_SELF_HOSTED_OPERATIONS.md), the [Open Core boundary](docs/architecture/OPEN_CORE_BOUNDARY.md), the [release checklist](docs/release/SPIDERBYTE_OPEN_CORE_RELEASE_CHECKLIST.md), and the [release migration plan](docs/release/SPIDERBYTE_OPEN_CORE_MIGRATION_PLAN.md) for repository and release requirements.

The accepted commercial direction is a seat-based, customer-owned
self-hosted edition. Customers operate their own infrastructure and provider
accounts; SpiderByte-hosted compute and model-usage billing are optional
future products, not prerequisites for the local or self-hosted release.

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
