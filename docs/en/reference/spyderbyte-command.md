# `spyderbyte` command

`spyderbyte` starts the local SpiderByte terminal agent. It uses SpiderByte Agent Core, persists sessions below `SPIDERBYTE_HOME`, and accepts a local or BYOK provider configuration.

```sh
spyderbyte [options]
spyderbyte <subcommand> [options]
```

## Main options

| Option | Short | Description |
| --- | --- | --- |
| `--version` | `-V` | Print the version and exit. |
| `--help` | `-h` | Print help. |
| `--session [id]` | `-S` | Resume a session or open the session picker. |
| `--continue` | `-c` | Resume the most recent session in the current directory. |
| `--model <model>` | `-m` | Select a model alias for this startup. |
| `--prompt <prompt>` | `-p` | Execute one prompt without opening the TUI. |
| `--output-format <format>` | | Use `text` or `stream-json` in prompt mode. |
| `--yolo` | `-y` | Auto-approve ordinary tool calls. |
| `--auto` | | Start in fully autonomous permission mode. |
| `--plan` | | Start in Plan mode. |
| `--skills-dir <dir>` | | Replace discovered Skill directories for this startup. |
| `--agent <name>` | | Select a discovered agent profile. |
| `--agent-file <path>` | | Select an agent definition from a file. |
| `--add-dir <dir>` | | Add a workspace directory for this session. |

`--continue` and `--session` are mutually exclusive. `--output-format` requires `--prompt`; prompt mode does not combine with `--yolo`, `--auto`, or `--plan`.

## Examples

```sh
spyderbyte
spyderbyte --continue
spyderbyte --session 01HZ...XYZ
spyderbyte -p "Summarize the current repository status"
spyderbyte -p "List changed files" --output-format stream-json
spyderbyte --plan
```

## Subcommands

| Command | Purpose |
| --- | --- |
| `spyderbyte configure` | Create a local provider connection and model selection. |
| `spyderbyte auth status` | Report accountless local authentication status. |
| `spyderbyte run <prompt>` | Execute one governed prompt through the canonical harness. |
| `spyderbyte provider` | List, add, remove, or discover provider records. |
| `spyderbyte connections` | List local provider connections for a workspace. |
| `spyderbyte usage` | Show local workspace usage records. |
| `spyderbyte plugins` | List locally installed plugins. |
| `spyderbyte organization` | Create, list, and select local organizations. |
| `spyderbyte project` | Create, list, and select local projects. |
| `spyderbyte workspace` | List and select local workspaces. |
| `spyderbyte acp` | Run the local Agent Client Protocol server over stdio. |
| `spyderbyte web` | Run the local REST/WebSocket server. The browser client is external to this checkout. |
| `spyderbyte doctor` | Validate `config.toml` and `tui.toml`. |
| `spyderbyte export` | Export a local session archive. |
| `spyderbyte upgrade` | Run the configured update check when updates are enabled. |

The `configure`, organization, project, workspace, connection, usage, and plugin commands operate on local persistence. They do not create hosted tenants, paid entitlements, invoices, or managed workers.

### `spyderbyte configure`

```sh
spyderbyte configure \
  --provider local \
  --model your-local-model \
  --base-url http://127.0.0.1:11434/v1 \
  --no-credentials
```

For a BYOK connection, set the environment variable named by `--api-key-env` instead of putting a secret in argv. Use `--skip-validation` only when the endpoint cannot be reached during configuration.

### `spyderbyte auth status`

```sh
spyderbyte auth status --json
```

The result identifies local mode and reports that hosted identity is excluded. It never contacts an account service.

### `spyderbyte provider`

```sh
spyderbyte provider list
spyderbyte provider add https://registry.example.test/api.json --api-key YOUR_API_KEY
spyderbyte provider catalog list
spyderbyte provider catalog add openai --default-model your-model
spyderbyte provider remove local
```

Catalog and registry commands are optional network integrations. Static local configuration remains supported when they are unavailable.

### `spyderbyte web`

```sh
spyderbyte web --no-open
spyderbyte web --port 58627 --host 127.0.0.1
spyderbyte web rotate-token
```

The server binds to loopback by default. It exposes the local REST and WebSocket contracts; the authoritative browser source is maintained in the external code-app project and is not shipped as an unreproducible bundle here.

### `spyderbyte doctor`

```sh
spyderbyte doctor
spyderbyte doctor config ./config.toml
spyderbyte doctor tui ./tui.toml
```

Missing default files are skipped because built-in defaults apply. Explicit paths must exist and parse successfully.

### `spyderbyte export`

```sh
spyderbyte export -y
spyderbyte export <session-id> -o ./session-export.zip --no-include-global-log
```

Review exported code, command output, file paths, and logs before sharing them.

## Open Core scope

Open Core includes local Organizations, Projects, Workspaces, Sessions, Runs, artifacts, policies, budgets, approvals, usage records, provider-neutral execution contracts, CLI/TUI, REST/WebSocket contracts, ACP, SDK, and Klient functionality that works without hosted services. Hosted identity, billing, subscriptions, managed providers, hosted workers, Slack/Teams integrations, and hosted approval routing are explicitly excluded.
