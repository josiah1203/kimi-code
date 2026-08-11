# Getting started

SpiderByte CLI is a local terminal agent for inspecting and changing projects, running tools under explicit approval, and preserving sessions on disk. The Open Core distribution runs accountless and accepts local or BYOK providers.

## Requirements

- Node.js `24.15.0` or later
- pnpm `10.33.0` for a checkout build
- A local model server or an API key for a provider you choose

## Run from a clean checkout

```sh
git clone https://github.com/SpiderByte/spiderbyte.git
cd spiderbyte
corepack enable
pnpm install --frozen-lockfile
pnpm run build:packages
pnpm --filter @spiderbyte/cli run build
node apps/cli/dist/main.mjs --version
```

For development, use the CLI's source runner:

```sh
pnpm --filter @spiderbyte/cli run dev:cli-only
```

The published package can be installed after a release with:

```sh
npm install -g @spiderbyte/cli
spyderbyte --version
```

No installer script, hosted account, or hosted credential is required for the checkout build.

## Configure a provider

Create `$SPIDERBYTE_HOME/config.toml` (default `~/.spiderbyte/config.toml`) with a local or BYOK connection:

```toml
default_model = "local"
telemetry = false

[providers.local]
type = "openai"
base_url = "http://127.0.0.1:11434/v1"
api_key = "local"

[models.local]
provider = "local"
model = "your-local-model"
max_context_size = 32768
capabilities = ["tool_use"]
```

Use `spyderbyte doctor` to validate the configuration. For a one-off process, use the `SPIDERBYTE_MODEL_*` environment variables described in [Environment variables](../configuration/env-vars.md).

## Start a session

From a project directory:

```sh
spyderbyte
```

For one non-interactive prompt:

```sh
spyderbyte -p "Describe this project's directory structure"
```

To resume the most recent session:

```sh
spyderbyte --continue
```

The first run creates local session and configuration data under `.spiderbyte` in the configured home directory. The TUI asks for approval before potentially destructive tools run.

## Useful commands

| Command | Description |
| --- | --- |
| `/new` | Start a new session. |
| `/sessions` | Browse and resume sessions. |
| `/model` | Switch the current model. |
| `/compact` | Compress the current context. |
| `/fork` | Create an independent copy of the session. |
| `/help` | Open the command and shortcut help panel. |
| `/exit` | Exit the TUI. |

Use `spyderbyte provider --help` to manage local provider records, and `spyderbyte export` to create a reviewable session archive.

## IDE integration

The ACP adapter is available locally through:

```sh
spyderbyte acp
```

See [Using SpiderByte CLI in IDEs](./ides.md) for editor configuration. ACP passes through the provider configuration of the local CLI process; it does not perform a hosted SpiderByte login.

## Data and commercial boundary

Runtime data lives below `SPIDERBYTE_HOME`: configuration, session records, policies, artifacts, logs, and optional external-provider token records. See [Data locations](../configuration/data-locations.md).

Hosted identity, subscriptions, billing, managed workers, hosted approval routing, and managed provider services are commercial capabilities outside this checkout. They are not prerequisites for the local platform.
