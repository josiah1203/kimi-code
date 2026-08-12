# ChatGPT MCP setup

## Current status

The Otis server is headless and does not register an MCP Apps UI resource.
ChatGPT can still use the structured MCP tools when a reachable authenticated
HTTPS endpoint is configured. The local stdio transport is for Codex and other
local MCP hosts; it is not directly reachable by ChatGPT.

## Developer Mode workflow

1. Start SpiderByte locally with `spyderbyte web --no-open`.
2. Keep the server bound to loopback and retain bearer authentication.
3. Expose only the `/mcp` route through an HTTPS development tunnel or an
   authenticating reverse proxy.
4. In ChatGPT, open Settings → Security and login → Developer mode, then add
   the MCP server using the HTTPS `/mcp` URL.
5. Supply the bearer credential through the supported connection setup; never
   paste it into a repository file or model prompt.
6. Call `spiderbyte_capabilities` and verify that the response says
   `local-only` for local workflows and `hosted-required` for hosted compute.

The exact UI labels and account availability are controlled by ChatGPT. This
repository does not claim that a developer-mode connection is a public
ChatGPT app listing.

## Production ChatGPT configuration

A public or team deployment needs a stable HTTPS origin, `/mcp` routing,
authentication and authorization, tenant/workspace enforcement, monitoring,
privacy policy, support contact, and a separately deployed hosted control
plane if hosted operations are enabled. None of those hosted services are
created by the local Open Core package.

## UI status

The server does not currently register `ui://` resources or rely on
`window.openai`. All operations work through headless tool calls. A future UI
may add run/artifact/dataset/approval views, but it must remain additive and
must preserve confirmation for destructive or billable actions.
