# Data locations

SpiderByte CLI stores all runtime data — the configuration, session history, external-provider token records, and diagnostic logs — under `~/.spiderbyte/`. This page helps you understand where each type of data lives, what it is for, and how to clean up or relocate it when needed.

## Data root directory

The default data root is `~/.spiderbyte/`. The actual path varies by platform:

- macOS: `/Users/<name>/.spiderbyte`
- Linux: `/home/<name>/.spiderbyte`
- Windows: `C:\Users\<name>\.spiderbyte`

If you need to move the data directory elsewhere (for example, to isolate configs for different projects with independent environments), set `SPIDERBYTE_HOME`:

```sh
export SPIDERBYTE_HOME="$HOME/.config/spiderbyte"
```

Once set, **all** SpiderByte data — config, sessions, logs, external-provider token records, SpiderByte user Skills, global `AGENTS.md`, and more — lands under the new path. For the full reference on `SPIDERBYTE_HOME`, see [Environment variables](./env-vars.md).

::: tip Note

**Generic `.agents` resources** stay under the real OS home so they can be shared across tools. For example, user-level generic Skills remain at `~/.agents/skills/`, while SpiderByte user Skills move with `SPIDERBYTE_HOME` as `$SPIDERBYTE_HOME/skills/`.
:::

## Directory layout

```
$SPIDERBYTE_HOME  (default: ~/.spiderbyte)
├── config.toml             # User configuration
├── tui.toml                # Terminal UI preferences (including auto-update toggle)
├── AGENTS.md               # Global SpiderByte-specific agent instructions (optional)
├── mcp.json                # User-level MCP server declarations (optional)
├── skills/                 # SpiderByte-specific user-level Skills (optional)
├── plugins/
│   ├── installed.json      # Installed plugin records and enabled state
│   └── managed/            # Plugin copies installed from zip/local paths
├── session_index.jsonl     # Session index
├── credentials/            # external-provider token records (dir 0700, files 0600)
│   ├── <name>.json
│   └── mcp/
│       └── <key>-<suffix>.json
├── sessions/               # Session data (see below)
│   └── <workDirKey>/<sessionId>/
├── bin/
│   ├── rg                  # managed ripgrep binary for Grep (rg.exe on Windows)
│   └── fd                  # managed fd binary for file references (fd.exe on Windows)
├── logs/
│   └── spiderbyte.log       # Global diagnostic log
├── updates/
│   ├── latest.json
│   ├── install.json
│   ├── install.lock
│   └── rollout.log
└── user-history/
    └── <md5(workDir)>.jsonl
```

## File descriptions

Each top-level file under the data root serves a specific purpose; most are managed automatically by the CLI:

- **`config.toml`**: the main runtime configuration file, storing user-level settings such as providers, models, and loop control. See [Configuration files](./config-files.md).
- **`tui.toml`**: terminal UI client preferences, including `[upgrade].auto_install` (auto-update, on by default). You can disable it in `/settings` or by manually setting `auto_install = false`.
- **`AGENTS.md`**: global SpiderByte-specific agent instructions. This file moves with `SPIDERBYTE_HOME`; generic cross-tool instructions can still live under `~/.agents/AGENTS.md`.
- **`mcp.json`**: user-level MCP server declarations, merged with the project-local `.spiderbyte/mcp.json` on startup. See [MCP](../customization/mcp.md).
- **`skills/`**: SpiderByte-specific user-level Skills. This directory moves with `SPIDERBYTE_HOME`; generic cross-tool Skills can still live under `~/.agents/skills/`. See [Agent Skills](../customization/skills.md).
- **`plugins/installed.json`**: records installed plugins, each plugin's enabled state, and MCP server capability state changes made via `/plugins` or `/plugins mcp disable|enable`. Files installed from local paths or zip URLs are copied to `plugins/managed/<id>/`. See [Plugins](../customization/plugins.md).
- **`credentials/`**: OAuth credential directory, with permissions `0o700` (directory) / `0o600` (files), readable and writable only by the current user. External provider credentials are stored as `credentials/<name>.json`; MCP server credentials are stored under `credentials/mcp/`. Credentials are written using an atomic flow (tmp → fsync → rename) to prevent corruption.

## Session data

Each session's data is stored under `sessions/<workDirKey>/<sessionId>/`, and a top-level `session_index.jsonl` index is maintained (one record per line, each containing `sessionId`, `sessionDir`, and `workDir`). `workDirKey` is a bucket name derived from the working directory path, in the format `wd_<slug>_<first-12-chars-of-sha256>`.

Inside each session directory:

- **`state.json`**: session metadata including title, `lastPrompt`, creation/update timestamps, and `forkedFrom`.
- **`upcoming-goals.json`**: the TUI-only queue created by `/goal next <objective>`. It is not part of the agent conversation until a queued goal is promoted after the current goal completes.
- **`agents/main/wire.jsonl`**: the main Agent's complete communication record, used for session resumption and replay.
- **`agents/main/plans/`**: plan files written in Plan mode, named by plan id (`<id>.md`).
- **`agents/agent-0/` etc.**: sub-Agent instance directories, each containing their own `wire.jsonl`.
- **`logs/spiderbyte.log`**: diagnostic log for this session; only present when a diagnostic event occurs.
- **`tasks/`**: background task persistence — `tasks/<task_id>.json` stores status/pid/exit code; `tasks/<task_id>/output.log` stores output.
- **`cron/`**: scheduled task persistence; reloaded into the scheduler when the session is resumed with `spyderbyte --session`. See [Scheduled tasks](../reference/tools.md#scheduled-tasks).

## Built-in tool cache

The first time the `Grep` tool needs ripgrep, the CLI can automatically download `rg` and cache it at `bin/rg` (`bin/rg.exe` on Windows). File-reference completion in the terminal UI uses `fd`; the CLI downloads and caches it at `bin/fd` (`bin/fd.exe` on Windows) in the background when needed. Subsequent runs reuse the cached binaries. `rg` prefers the system `PATH` before the cache, while `fd` checks the managed cache before falling back to system `fd` / `fdfind`. Deleting the `bin/` directory triggers a fresh download on the next use.

## Logs and update state

- **`logs/spiderbyte.log`** (global): records startup, external authentication, and export, and other cross-session events.
- **`<sessionDir>/logs/spiderbyte.log`** (session-level): records diagnostic events within a single session.

When reporting a bug, prefer exporting the relevant session with `spyderbyte export` (see [spyderbyte command](../reference/spyderbyte-command.md)); the session log is included in the export by default. Add `--no-include-global-log` if you do not want to share the global log.

The files under `updates/` (`latest.json`, `install.json`, `install.lock`, `rollout.log`) are maintained automatically by the auto-update mechanism and normally do not need manual editing. `rollout.log` records which staged-rollout case each update check hit, which helps explain when a device will receive a new release.

## Input history

Terminal input history is saved separately per working directory, at `user-history/<md5(workDir)>.jsonl`. It is used to browse previously typed prompts in the terminal UI using the arrow keys.

## Clearing data

Deleting the data root directory (`~/.spiderbyte/` or the path set by `SPIDERBYTE_HOME`) removes all runtime data. To clear only part of the data:

| Goal | Action |
| --- | --- |
| Reset configuration | Delete `~/.spiderbyte/config.toml` |
| Reset terminal UI preferences | Delete `~/.spiderbyte/tui.toml` |
| Clear all sessions | Delete `~/.spiderbyte/sessions/` and `session_index.jsonl` |
| Clear diagnostic logs | Delete `~/.spiderbyte/logs/` |
| Clear input history | Delete `~/.spiderbyte/user-history/` |
| Reset update state | Delete `~/.spiderbyte/updates/latest.json` |
| Force re-download of managed `rg` and `fd` | Delete `~/.spiderbyte/bin/` |
| Clear provider OAuth login state | Run `/logout`, or delete the corresponding `credentials/<name>.json` |
| Clear MCP server OAuth login state | Delete `credentials/mcp/` (`/logout` does not clear MCP credentials) |
| Remove user-level MCP declarations | Delete `$SPIDERBYTE_HOME/mcp.json` (default `~/.spiderbyte/mcp.json`) |
| Clear global SpiderByte-specific agent instructions | Delete `$SPIDERBYTE_HOME/AGENTS.md` (default `~/.spiderbyte/AGENTS.md`) |
| Clear plugin install records | Delete `$SPIDERBYTE_HOME/plugins/` (local plugin source directories are not affected) |
| Clear SpiderByte-specific user-level Skills | Delete `$SPIDERBYTE_HOME/skills/` (default `~/.spiderbyte/skills/`) |

## Next steps

- [Configuration files](./config-files.md) — full reference for `config.toml` fields
- [Environment variables](./env-vars.md) — detailed usage of `SPIDERBYTE_HOME` and related path variables
