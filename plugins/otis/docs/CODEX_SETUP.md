# Codex CLI and IDE setup

Codex CLI and the Codex IDE extension use the same MCP configuration model.
Project configuration is loaded only when the project is trusted.

## Install the local plugin from this checkout

The repository includes a personal marketplace entry at
`.agents/plugins/marketplace.json`. From the checkout’s parent environment,
add the repository marketplace and install Otis:

```bash
codex plugin marketplace add /absolute/path/to/spiderbyte
codex plugin list
codex plugin add otis@personal
```

If the marketplace is already configured, only the last two commands are
needed. The plugin bundles `.mcp.json`, so the local `spiderbyte-local` server
uses the `spyderbyte mcp` executable.

## Direct project MCP configuration

If you want to configure the MCP server without installing the plugin, add the
following to a trusted project `.codex/config.toml`:

```toml
[mcp_servers.spiderbyte-local]
command = "spyderbyte"
args = ["mcp"]
startup_timeout_sec = 20
tool_timeout_sec = 60
```

To choose a default local workspace without putting an identifier in the TOML
file, export it in the environment used to launch Codex:

```bash
export SPIDERBYTE_MCP_WORKSPACE_ID="workspace-id"
```

The tracked repository `.codex/config.toml` sets the default model to
`gpt-5.3-codex`; that model selection is independent of the MCP server.

## Remote Streamable HTTP configuration

Use a real HTTPS deployment only:

```toml
[mcp_servers.spiderbyte-hosted]
url = "https://mcp.example.com/mcp"
bearer_token_env_var = "SPIDERBYTE_MCP_TOKEN"
startup_timeout_sec = 20
tool_timeout_sec = 60
```

Set `SPIDERBYTE_MCP_TOKEN` in the process environment or a secret manager. Do
not check in the token or pass it as a command-line argument. The repository
does not ship `mcp.example.com`; it is a configuration placeholder.

## Direct Codex MCP commands

Codex also supports an explicit local registration:

```bash
codex mcp add spiderbyte-local -- spyderbyte mcp
```

For an already deployed endpoint:

```bash
codex mcp add spiderbyte-hosted \
  --url "https://mcp.example.com/mcp" \
  --bearer-token-env-var SPIDERBYTE_MCP_TOKEN
```

Verify the effective configuration with `codex mcp list` and inspect the
server with `codex mcp get spiderbyte-local`.
