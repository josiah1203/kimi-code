# SpiderByte Web

The SpiderByte web frontend is one Next.js App Router application with Clerk
authentication, Clerk Billing UI, and a Discord-like collaboration projection.
The browser talks to SpiderByte through `@spiderbyte/client/browser` and the
typed `@spiderbyte/protocol` contracts. It does not import Agent Core, Prisma,
provider implementations, or the legacy process-local Socket.IO server.

SpiderByte remains authoritative for workspaces, sessions, prompts, runs,
attempts, transcripts, artifacts, policies, approvals, budgets, usage, and
authorization. The commercial packages remain the source of truth for hosted
identity, entitlements, billing, and audit state.

## Development

From the repository root:

```bash
pnpm install
pnpm dev:web
```

The app runs at `http://localhost:3000`. The Clerk CLI can refresh the local
development keys with:

```bash
clerk env pull --app YOUR_CLERK_APP_ID --file .env.local
```

Keep `CLERK_SECRET_KEY` server-only. The browser uses only the publishable key
from `.env.local`.

## Connecting the platform

The Next.js BFF requires both a server URL and a server-only SpiderByte bearer
credential:

```dotenv
SPIDERBYTE_API_URL=http://127.0.0.1:8000
SPIDERBYTE_API_TOKEN=YOUR_SPIDERBYTE_SERVER_TOKEN
```

The BFF verifies the Clerk session, then uses `SPIDERBYTE_API_TOKEN` for the
upstream kap-server. A Clerk JWT is never treated as a local daemon token. When
`SPIDERBYTE_IDENTITY_BRIDGE_SECRET` is configured, the BFF also signs a
short-lived, provider-neutral delegated-principal assertion for kap-server.
Kap-server verifies that assertion and binds the request to the Clerk-derived
actor and organization; the upstream service still performs
organization/project/workspace/session/run authorization. Set
`SPIDERBYTE_REQUIRE_IDENTITY_BRIDGE=1` for a hosted deployment that must fail
closed if this binding is absent. The commercial identity synchronization and
webhook reconciliation path is still a separate deployment gate. The hosted
commercial session route does synchronize Clerk membership into the commercial
store; platform organization/project/workspace binding and webhook-driven
billing reconciliation remain separate gates.

Set `SPIDERBYTE_REQUIRE_COMMERCIAL_SESSION_SYNC=1` when the web deployment is
hosted. In that mode every forwarded platform request first verifies the Clerk
token with `SPIDERBYTE_COMMERCIAL_API_URL/api/v1/commercial/session`, so the
commercial membership sync cannot be reached only through an optional UI panel.
The same check runs before `/api/identity/ws` issues a realtime assertion.

The Billing view also reads the optional server-only
`SPIDERBYTE_COMMERCIAL_API_URL`. The capabilities request is diagnostic; the
commercial session request forwards a verified Clerk token through the Next.js
BFF to the hosted `/api/v1/commercial/session` route. That route synchronizes
membership before returning the authorized tenant projection. A configured
Clerk pricing surface is still presentation only until billing webhook
reconciliation and entitlement checks are wired through the same server-side
authority.

Set `NEXT_PUBLIC_SPIDERBYTE_WORKSPACE_ID` or
`NEXT_PUBLIC_SPIDERBYTE_SESSION_ID` only as optional UI defaults. The server
must return those resources for the signed-in principal; browser-provided IDs
are not authorization inputs.

The collaboration surface uses REST transcript/run catch-up by default. A
direct authorized platform WebSocket can be enabled with
`NEXT_PUBLIC_SPIDERBYTE_WS_URL`; the client obtains a 30-second identity
subprotocol from `/api/identity/ws`, then uses cursors, replay, duplicate
suppression, and gap recovery. Expose that WebSocket endpoint through the
deployment’s TLS-aware reverse proxy; Next.js Route Handlers do not proxy the
upgrade. The browser uses the same host’s `/api/v2/collaboration/ws` endpoint
for durable channel messages and `/api/v2/platform/ws` for run/platform events.
Collaboration cursors cover both message creation and projection revisions:
`sequence` remains the stable message identity order while `event_sequence`
advances for state, run, approval, cancellation, or artifact-link changes.
The old Discord clone’s Prisma and Socket.IO paths are not mounted in this app.
REST catch-up remains the recovery path when realtime is not configured or a
connection reports an event gap.

Collaboration channels, threads, and messages are persisted by kap-server under
the workspace-scoped collaboration store. Message commands validate the
workspace/session binding, persist an idempotent message projection, and
dispatch through the existing Agent Core gateway; they do not execute the
runtime inside Next.js.

The run inspector’s cancellation control calls the collaboration cancellation
command, which cancels the authoritative session loop and linked Run. A Run
that has already reached a terminal state is reported as non-cancellable.

When the authoritative Run enters `awaiting_approval`, the inspector reads
pending approvals through the existing v1 approval routes and resolves them
server-side. Failed or cancelled Runs expose Retry, and succeeded Runs expose
Rerun, both through the existing v2 Run service; the browser only supplies a
request id.

The integration authority matrix, migration risks, and deferred Prisma/data
retirement plan are recorded in
`docs/architecture/DISCORD_FRONTEND_INTEGRATION.md`.
