# Otis troubleshooting

## `workspace_required`

Pass `workspace_id` to the tool, set `SPIDERBYTE_MCP_WORKSPACE_ID`, or launch:

```bash
spyderbyte mcp --profile curated --workspace <workspace-id>
```

## `401 Unauthorized` from HTTP MCP

Use the bearer token generated under the SpiderByte home directory and pass it
through the MCP client’s secure configuration. Do not use
`--dangerous-bypass-auth` for a tunneled or production server.

## Plain Node fails on a clean checkout

The monorepo keeps the Agent Core workspace export pointed at TypeScript for
source-based development. A direct `node apps/cli/dist/main.mjs mcp` run from
the checkout can therefore resolve a `.ts` workspace module. Use the dev
runner for a source checkout:

```bash
pnpm --filter @spiderbyte/cli run dev:cli-only -- mcp
```

The supported installed path is the packed/published `spyderbyte` executable;
the package-artifact rehearsal verifies its installable export layout.

## `hosted-required`, `provider-unavailable`, or `enterprise-only`

Call `get_capabilities` when the daemon was started with
`SPIDERBYTE_MCP_PROFILE=curated`; otherwise use the full-profile
`spiderbyte_capabilities`. The response is the source of truth for
the current checkout. Hosted compute, billing, hosted identity, provider
OAuth, and enterprise controls cannot be enabled by changing a local flag.

## `confirmation_required`

The operation can cancel work, resume work, train a model, stage a model, close
a session, or otherwise consume/alter resources. Confirm with the user and
retry with `confirmed: true`.

## Provider or model failures

Inspect the configured provider through the local CLI/full MCP profile;
credentials are configured locally and
are never returned. Then inspect execution targets and policy/budget state.

## Empty search/fetch results

Use `search` first, then pass the returned exact `spiderbyte://` URI to
`fetch`. A URI from another workspace intentionally fails with a scope error.

## UI expectations

There is no Otis MCP Apps UI yet. Use structured tool results in the client.
Run/artifact/dataset/approval visualization is planned and must not be
reported as available today.
