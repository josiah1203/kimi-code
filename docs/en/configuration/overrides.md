# Configuration overrides

SpiderByte has three configuration layers: the TOML file, command-line options, and explicit environment variables. Each layer has a defined scope rather than one universal priority rule.

- The TOML file stores durable local preferences.
- Command-line options apply to one startup.
- Environment variables relocate data, select an environment model, or enable a documented runtime switch.

## Priority

For ordinary runtime settings, command-line options have priority over the user configuration file. Environment variables override only the fields they document. Provider credentials do not fall back to arbitrary shell variables.

Provider credentials resolve in this order:

1. The encrypted material addressed by `[providers.<name>].secret_ref`, or a process-local `SPIDERBYTE_MODEL_API_KEY` overlay.
2. A legacy `[providers.<name>].api_key` or credential entry in `[providers.<name>.env]` is migrated at startup when the secret-store key is available.
3. The matching non-secret endpoint value in `[providers.<name>.env]` and `base_url`.
4. A stable missing-credential or missing-endpoint error.

The `[providers.<name>.env]` table is still part of `config.toml`; it does not mutate the shell environment. New durable credentials should use `spyderbyte configure` or a provider import command.

The one-shot `SPIDERBYTE_MODEL_*` channel creates an in-memory model and provider for the current process. It is useful for smoke tests and BYOK, and is never written to disk.

## Command-line options

| Option | Effect |
| --- | --- |
| `-S, --session [id]` | Resume a session or open the session picker. |
| `-c, --continue` | Resume the most recent session in the current directory. |
| `-y, --yolo` | Auto-approve ordinary tool calls. |
| `--auto` | Start in fully autonomous permission mode. |
| `--plan` | Start in Plan mode. |
| `-m, --model <model>` | Select a model alias for this startup. |
| `-p, --prompt <prompt>` | Run one prompt and exit. |
| `--output-format <format>` | Select `text` or `stream-json` for prompt mode. |
| `--skills-dir <dir>` | Replace discovered Skill directories for this startup. |

`--output-format` requires `-p`; `--continue` and `--session` cannot be combined; and non-prompt `--yolo`/`--plan` combinations follow the CLI option validation rules.

## Isolated local environments

Use a separate data root for tests or projects that need independent configuration:

```sh
SPIDERBYTE_HOME="$PWD/.spiderbyte-sandbox" spyderbyte --version
```

For a one-off BYOK model, use the environment overlay:

```sh
SPIDERBYTE_MODEL_NAME=your-local-model \
SPIDERBYTE_MODEL_PROVIDER_TYPE=openai \
SPIDERBYTE_MODEL_BASE_URL=http://127.0.0.1:11434/v1 \
SPIDERBYTE_MODEL_API_KEY=local \
spyderbyte -p "Describe the current directory"
```

## Next steps

- [Configuration files](./config-files.md)
- [Environment variables](./env-vars.md)
- [Providers and models](./providers.md)
