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
| `spyderbyte connections` | Manage workspace-scoped execution targets with `list`, `add`, `inspect`, `test`, `ready`, and `remove`. |
| `spyderbyte usage` | Show local workspace usage records. |
| `spyderbyte plugins` | List locally installed plugins. |
| `spyderbyte organization` | Create, list, and select local organizations. |
| `spyderbyte project` | Create, list, and select local projects. |
| `spyderbyte workspace` | List and select local workspaces. |
| `spyderbyte acp` | Run the local Agent Client Protocol server over stdio. |
| `spyderbyte web` | Run the local REST/WebSocket server. The browser client is external to this checkout. |
| `spyderbyte daemon platform-worker --stdio` | Run the customer-owned semantic execution daemon used by governed SSH targets. |
| `spyderbyte doctor` | Validate `config.toml` and `tui.toml`. |
| `spyderbyte export` | Export a local session archive. |
| `spyderbyte upgrade` | Run the configured update check when updates are enabled. |

The `configure`, organization, project, workspace, connection, usage, and plugin commands operate on local persistence. They do not create hosted tenants, paid entitlements, invoices, or managed workers.

`spyderbyte connections` registers only endpoint references and opaque
`secret_<reference>` values. `connections test` performs a bounded health and
capability check for local targets, governed SSH targets, and supported HTTP
worker or private-gateway targets; Docker and Kubernetes targets report
`adapter-dependent` until their transport adapters are installed. SSH requires
an already-installed, compatible customer daemon and fails closed when the
host-key fingerprint or daemon protocol does not match. A target must pass
`connections test` before `connections ready` can make it leasable; a failed
check drains a previously ready target. Customer-managed worker endpoints are
public-network only; an explicitly configured private-gateway may use a
customer-private address, but loopback and link-local destinations are
rejected. `connections remove`
revokes the target while retaining its durable record for local audit history.

### SSH execution targets

SSH is an execution transport for a customer-owned SpiderByte daemon, not a
model-facing shell tool. Register a target with explicit host, user,
fingerprint, and confined remote root settings:

```sh
spyderbyte connections add \
  --workspace wd_example \
  --name customer-ssh \
  --type ssh \
  --ssh-host runner.example.test \
  --ssh-user spiderbyte \
  --ssh-host-key YOUR_SHA256_HEX_FINGERPRINT \
  --ssh-root /srv/spiderbyte/workspaces/example \
  --auth-method ssh_agent
```

Key authentication uses `--auth-method ssh_key` plus an opaque
`--credential-ref secret_<reference>`; private key material is never accepted
on the command line or stored in the target record. The transport passes only
the protocol version and workspace ID to the fixed remote command
`spyderbyte daemon platform-worker --stdio`. Arbitrary shell execution is not
exposed by this interface.

### `spyderbyte configure`

```sh
spyderbyte configure \
  --provider local \
  --model your-local-model \
  --base-url http://127.0.0.1:11434/v1 \
  --no-credentials
```

For a BYOK connection, set `SPIDERBYTE_SECRET_STORE_KEY`, then set the environment variable named by `--api-key-env` instead of putting a secret in argv. The command stores encrypted material and persists only an opaque reference. Use `--skip-validation` only when the endpoint cannot be reached during configuration.

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

Catalog and registry commands accept `--api-key` only as transient setup input and persist an encrypted secret reference. Static local configuration remains supported when they are unavailable.

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

Open Core includes local Organizations, Projects, Workspaces, Sessions, Runs, artifacts, policies, budgets, approvals, usage records, provider-neutral execution contracts, CLI/TUI, REST/WebSocket contracts, ACP, SDK, and the local client facade functionality that works without hosted services. Hosted identity, billing, subscriptions, managed providers, hosted workers, Slack/Teams integrations, and hosted approval routing are explicitly excluded.
