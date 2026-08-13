# Otis local development

## Prerequisites

- Node.js `>=24.15.0`;
- pnpm `10.33.0`;
- a local SpiderByte checkout;
- an explicitly configured local or BYOK provider only when a workflow needs
  model execution.

Do not put provider secrets in this plugin directory, `.codex/config.toml`,
`.mcp.json`, shell history, or tool arguments. SpiderByte stores only opaque
secret references in public provider records.

## Build and validate

Run from the repository root:

```bash
pnpm install
pnpm --filter @spiderbyte/protocol build
pnpm --filter @spiderbyte/kap-server typecheck
pnpm --filter @spiderbyte/kap-server build
pnpm --filter @spiderbyte/cli typecheck
pnpm --filter @spiderbyte/cli build
pnpm --filter @spiderbyte/kap-server exec vitest run test/mcp.test.ts --pool=threads --maxWorkers=1
python3 /Users/josiah/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/otis
git diff --check
```

The MCP test covers modern 2026-07-28 discovery, per-request envelopes,
standard HTTP headers, result typing, stateless requests, tool metadata and
malformed input, plus the authenticated Streamable HTTP path. The HTTP test
opens a loopback listener and may require the test runner’s network permission
in a restricted environment.

## Start the local transports

Stdio, used by Codex and other local MCP clients:

```bash
spyderbyte mcp --profile curated --workspace <local-workspace-id>
```

HTTP, used for development tunnels and ChatGPT MCP configuration:

```bash
SPIDERBYTE_MCP_PROFILE=curated spyderbyte web --no-open
```

The HTTP server prints the loopback origin and bearer token. Keep the token
private. For a development tunnel, tunnel the loopback `/mcp` endpoint over
HTTPS and configure the tunnel hostname in the tunnel’s allowlist. Do not
disable bearer auth on an exposed interface.

## Inspect the server without a UI

After an authenticated HTTP connection, inspect `tools/list` and call
`get_capabilities` first. It reports local-only, credential-required,
hosted-required, provider-unavailable, enterprise-only, and planned states.

For a stdio smoke test, use an MCP client rather than piping arbitrary text to
stdout: stdout is reserved for JSON-RPC, while diagnostics go to stderr.
