# Security and data flow

## Trust boundaries

1. The MCP client is untrusted input and supplies JSON-RPC arguments.
2. The MCP adapter validates schemas, resolves request IDs, enforces workspace
   scope, and redacts output.
3. SpiderByte App/Workspace/Session services own authorization, policy,
   persistence, and execution decisions.
4. Local providers or customer-managed targets are external boundaries and are
   used only when explicitly configured.

## Controls implemented in the adapter/server

- official MCP SDK schema validation;
- existing Fastify bearer authentication for `/mcp`;
- host and origin checks from the existing server;
- per-source MCP request rate limiting;
- request/correlation ID propagation;
- bounded result text and bounded artifact content;
- recursive secret-like key redaction;
- workspace and session isolation;
- path confinement for session working directories;
- explicit confirmation gates;
- append-only MCP invocation audit events;
- graceful HTTP session cleanup and bounded operation timeout responses.

## Important limitations

The local Open Core server does not implement hosted tenant authority,
provider OAuth, commercial entitlements, managed secrets, managed workers,
enterprise controls, or a hosted deletion/retention service. The local
operation timeout protects the MCP response boundary; long-running domain work
must still be cancelled through the canonical Run or training service.

There is no ChatGPT UI in this version, so there is no iframe domain or CSP
allowlist to claim. A future UI must use MCP Apps metadata and preserve the
headless tool path.

## Secret handling

Never return or log API keys, bearer tokens, passwords, refresh tokens, secret
references with sensitive values, or authorization headers. Use the local
provider connection and secret-store contracts. For hosted deployments, use a
separate secret manager and tenant-bound resolver.
