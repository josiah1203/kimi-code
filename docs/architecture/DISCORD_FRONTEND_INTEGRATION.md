# Discord-like frontend integration

Status: phased integration in progress. This document records the authority
matrix and migration decisions for bringing the non-Git `discord-clone-main`
frontend into `apps/web`; it does not claim hosted or enterprise readiness for
capabilities that remain unconfigured.

## Repository relationship

`/Users/josiah/kimi` is the SpiderByte platform repository and remains the
destination. `/Users/josiah/Downloads/discord-clone-main` is a standalone
Next.js application with no `.git` directory in the available checkout, so
there is no local frontend commit history to preserve. Its reusable UI and
interaction model are being integrated into the existing `@spiderbyte/web`
application rather than creating a second Next.js app.

The platform uses pnpm workspaces with `packages/*`, `commercial/*`, and
`apps/*` membership. `apps/web` is already registered in both
`pnpm-workspace.yaml` and the explicit workspace lists in `flake.nix`.

## Phase 0 audit summary

The platform repository is the only Git-backed destination in the available
checkouts. The frontend directory has no `.git` metadata, so a subtree/merge
cannot preserve frontend commit history; the integration preserves source
behavior and records the intentional retirement boundaries below. The
platform uses pnpm, Nix workspace registration, and package-local build/test
scripts. The existing `apps/web` shell was preserved and is now the one
canonical Next.js application.

The relevant platform package graph is:

```text
apps/web → @spiderbyte/client/browser → @spiderbyte/protocol
apps/web → Next.js BFF → kap-server → @spiderbyte/agent-core
kap-server → @spiderbyte/transcript / @spiderbyte/minidb
commercial/hosted → commercial/domain + ports + persistence + adapters
apps/cli → @spiderbyte/sdk / client → Agent Core and kap-server contracts
```

The original frontend dependency graph included Next.js, Clerk, Prisma/PostgreSQL,
Socket.IO, React Query, LiveKit, UploadThing, and channel/message UI. Only the
browser-safe Clerk/UI interaction model and reusable visual surface are mounted
in `apps/web`; Prisma, clone-owned API routes, Socket.IO authority, and secret
adapters remain isolated until an approved replacement exists.

The main duplicate responsibilities were identity/membership, Server/Channel/
Message persistence, authorization, and realtime fan-out. SpiderByte now owns
the platform-side collaboration projection and run links; the clone’s Prisma
tables and process-local Socket.IO server are not mounted. Clerk remains the
hosted presentation/session boundary. A signed, provider-neutral delegated
principal bridge now binds Clerk-derived actor and organization IDs to
kap-server when configured; commercial identity synchronization and hosted
tenant provisioning remain separate deployment gates.

## Authority matrix

| Concept | Canonical authority | Browser representation | Migration decision |
| --- | --- | --- | --- |
| Clerk identity and hosted session | `commercial/*` identity boundary plus Clerk | Clerk UI/session token | Keep Clerk UI in `apps/web`; verify the session in the BFF and use an explicit platform credential upstream |
| Organization, project, workspace | SpiderByte business/platform services | Typed protocol projections | Do not map a Discord Server to an organization or project implicitly |
| Collaboration channel/thread/message | `kap-server` CollaborationService + workspace-scoped MiniDb projection | Typed web adapter state | Retain Discord-like layout; do not write Prisma `Server`, `Channel`, or `Message` rows |
| Session, run, attempt, transcript | SpiderByte Agent Core and kap-server | `@spiderbyte/client/browser` plus protocol types | Prompt submission uses the existing session route; run/transcript state is caught up from platform APIs |
| Artifact, dataset, environment, execution target | SpiderByte platform services | Browser-safe client methods | Display only server-returned resources and truthful unavailable states |
| Policy, approval, budget, usage, audit | SpiderByte governance/commercial services | Server decisions and read projections | Never calculate entitlement, budget, or authorization in React |
| Billing, seats, entitlements | `commercial/billing` and identity adapters | Clerk billing UI where configured | Clerk renders the billing surface; SpiderByte remains the enforcement authority |
| Realtime | SpiderByte authorized WS plus REST replay | `BrowserPlatformClient` event stream | Use cursor/replay semantics; do not carry process-local Socket.IO into production |
| Voice/video and uploads | Customer-managed optional adapters | Feature-gated UI surface | Keep the interaction surface, but report LiveKit/token service as unavailable until configured |

## Package and import boundary

The web application may import `@spiderbyte/protocol` and the browser entry
point of `@spiderbyte/client`. It must not import `@spiderbyte/agent-core`,
filesystem/process/SSH implementations, provider adapters, secret-bearing
commercial modules, Prisma, or MCP as a browser transport.

The Next.js BFF lives in `apps/web/app/api/v1/[...path]` and
`apps/web/app/api/v2/[...path]`. It verifies the Clerk session, forwards only
the allow-listed organization/project/workspace/session routes, and keeps both
`SPIDERBYTE_API_URL` and `SPIDERBYTE_API_TOKEN` server-only. If
`SPIDERBYTE_IDENTITY_BRIDGE_SECRET` is configured, it signs a short-lived
delegated-principal assertion; kap-server verifies it before resolving
organization/project/workspace authorization. Clerk's browser JWT is never
treated as the local kap-server bearer credential. The upstream SpiderByte
service still decides organization, project, workspace, session, run, artifact,
policy, budget, and entitlement authorization.

For hosted multi-tenancy, set `SPIDERBYTE_REQUIRE_IDENTITY_BRIDGE=1` and use
the same bridge secret on the web server and kap-server. The bridge prevents a
shared local actor from authorizing multiple Clerk organizations, but it does
not replace commercial organization/membership synchronization. The hosted
commercial session route now performs that synchronization into the commercial
store; binding those synchronized memberships to kap-server's organization,
project, and workspace records remains an explicit deployment gate.
Set `SPIDERBYTE_REQUIRE_COMMERCIAL_SESSION_SYNC=1` in the hosted web deployment
to make every REST BFF request and every `/api/identity/ws` assertion request
pass through that commercial session check before reaching platform resources.

## Frontend migration decisions

Preserved from `discord-clone-main`:

- server/project rail, channel sidebar, channel header, message stream, and composer interaction model;
- responsive layout behavior and loading/error/empty affordances;
- optional voice/video entry point as an honest unavailable state;
- the visual direction and reusable collaboration concepts.

Intentionally not imported as production authority:

- Prisma schema and direct database access;
- `pages/api/socket/io.ts` and process-local Socket.IO broadcasts;
- unscoped message/direct-message API routes;
- old Clerk middleware and server helpers tied to the clone’s data model;
- clone-owned LiveKit token and UploadThing authority paths.

No legacy frontend data is deleted or migrated by this phase. A later data
migration must preserve legacy IDs, define explicit Server/Channel/Message to
Organization/Project/Workspace/Collaboration mapping, validate ownership and
counts, and provide recovery before any retirement.

### Data migration and retirement plan

No Prisma rows have been copied, transformed, or deleted. The proposed mapping
is explicit rather than positional: a reviewed legacy `Server` maps to an
existing or newly approved SpiderByte organization/project binding; a legacy
channel maps to a workspace-owned collaboration channel; a legacy thread or
conversation boundary maps to a collaboration thread; and a legacy message
maps to a collaboration message with a `legacy_source_id` mapping record.
Direct-message membership, authorship, attachments, timestamps, visibility,
and legacy-to-new IDs require separate validation. A Server must never be
silently treated as a Project, and a Message must never be treated as a
transcript item.

The migration, when authorized, must be resumable and idempotent, write mapping
records before dependent messages, validate per-tenant counts and ownership,
retain the original timestamps/authors/attachments, and produce a recovery
report. The Prisma schema/API and Socket.IO code remain read-only legacy
references until that report passes. Retirement then proceeds in order:
freeze legacy writes, run consistency checks, cut over reads to the
SpiderByte projection, retain an export/recovery window, and only then remove
the legacy authority paths in a separately approved change.

## Collaboration model

The web projection follows this shape:

```text
Organization → Project → Workspace → CollaborationChannel → Thread
                                           ↓                  ↓
                                  CollaborationMessage → Run / Attempt / Artifact
```

`packages/kap-server` now owns a durable collaboration projection in its
workspace-scoped MiniDb. It lazily creates `general`, `run-monitor`, and
`approvals` channels plus a default thread, persists channels/threads/messages,
assigns monotonically increasing channel message sequences, and records
`client_message_id` idempotency. The v2 REST contract is:

- `GET/POST /api/v2/workspaces/:workspace_id/collaboration/channels`;
- `GET/POST .../channels/:channel_id/threads`;
- `GET/POST .../channels/:channel_id/messages`;
- `POST .../channels/:channel_id/messages/command` for the message-to-run
  vertical slice; and
- `POST .../messages/:message_id/cancel` for an authorized cancellation of the
  linked Agent Core session loop and durable Run; and
- `PATCH .../messages/:message_id` for server-authorized run/artifact state
  links.

The command route verifies the session/workspace binding, checks the existing
platform `run.execute` authorization, persists the user projection, and
dispatches through the existing Agent Core REST gateway. A serialized command
queue prevents concurrent retries from enqueueing the same prompt twice. The
platform session/run/transcript remains authoritative; collaboration records
are human-readable projections and links. Cancellation addresses the session
gateway and Run service first, and rejects already-terminal Runs instead of
pretending a projection changed execution state.

## Realtime and recovery plan

When `NEXT_PUBLIC_SPIDERBYTE_WS_URL` is configured, the browser subscribes to
the authorized SpiderByte platform event stream with the client’s cursor and
uses replay on gaps. The browser obtains a 30-second identity subprotocol from
`/api/identity/ws`; it does not send the Clerk JWT as a kap-server bearer
protocol. Without a direct WS endpoint, the same UI uses bounded transcript/run
and collaboration REST catch-up polling. Neither path uses Socket.IO or global
broadcasts. The `/api/v2/collaboration/ws` stream is backed by the durable
collaboration cursor and polls the MiniDb projection for live messages; REST
remains its replay/recovery path. Collaboration list responses expose a durable
`after_sequence`/`next_cursor` contract over message creation and projection
revision events. A message keeps its stable creation `sequence` while every
state/link change receives a new `event_sequence`, allowing run, approval,
cancellation, and artifact projections to replay without duplicating message
identity. The remaining production realtime work is deployment-level channel
subscription/replay and subscription security testing with the actual hosted
topology.

## Commercial integration matrix

| Capability | Current status | Web behavior |
| --- | --- | --- |
| Clerk sign-in and organization UI | Available in the shell | Keep Clerk UI; BFF requires a verified session |
| Signed delegated principal bridge | Available when configured | BFF signs a short-lived assertion; kap-server verifies and enforces the actor/organization binding |
| Clerk billing presentation | UI surface available when configured | Render pricing UI; do not infer entitlements client-side; show the commercial capability diagnostic beside it |
| Billing reconciliation and entitlement enforcement | Not configured/not implemented in hosted Worker | Report the server-side status; never treat a Clerk plan selection as an entitlement grant |
| Commercial identity adapter in hosted runtime | Hosted session route synchronizes Clerk membership into the commercial store; kap-server tenant binding remains open | Do not claim full hosted platform tenancy readiness |
| Hosted compute/artifact storage | Adapter-dependent/not configured | Show unavailable or customer-managed state |
| Usage, budgets, policies, approvals | Platform contracts exist | Read and enforce through authorized server routes |
| SSO/SCIM, managed OpenRouter, managed compute | Not verified in this checkout | Do not expose as functional controls |

## Risk register and unresolved decisions

1. The current kap-server authorization path is local-first, while Clerk
   verification, delegated-principal signing, and commercial identity
   synchronization are separate package boundaries. The bridge binds requests
   when configured; hosted deployment still must bind the synchronized
   commercial organizations and memberships to platform resources.
2. The collaboration-channel/message contract now exists for local kap-server
   projections, but hosted persistence, cross-process event publication, and
   organization-level identity binding still need commercial integration before
   it can serve as a hosted migration target.
3. Next.js Route Handlers do not proxy WebSocket upgrades. Deployments must
   expose an authorized WS endpoint or use REST catch-up; a production Socket.IO
   fallback is not acceptable.
4. The clone’s LiveKit and UploadThing integrations require server-side
   authorization and secret handling that are not present in the current web
   app. They remain optional and visibly unconfigured.
5. A complete end-to-end hosted test needs a SpiderByte server configured with
   a provider, execution target, identity adapter, and authorization fixtures.
   The web shell reports those missing prerequisites instead of manufacturing
   success states.

## Phase checklist

- [x] Audit repository trees, Git state, workspace metadata, manifests, routes, Prisma, Socket.IO, Clerk, and platform exports.
- [x] Establish authority matrix and preserve/retire decisions.
- [x] Keep one canonical Next.js app at `apps/web`.
- [x] Add a typed browser adapter and authenticated Next.js BFF boundary.
- [x] Replace the signed-in placeholder dashboard with a Discord-like collaboration projection.
- [x] Add a durable SpiderByte collaboration projection and persistence contract.
- [x] Connect a collaboration command to a server-authorized session prompt and durable message/run link.
- [x] Add an authorized collaboration cancellation command for linked session/run state.
- [x] Add server-side channel/thread visibility checks and message idempotency coverage.
- [x] Add a durable collaboration WebSocket with channel/thread cursor replay and live-message integration coverage.
- [x] Add a browser commercial-capability diagnostic boundary that reports unconfigured hosted identity/billing honestly.
- [x] Add a signed delegated-principal bridge for BFF REST and direct platform WebSocket requests.
- [x] Add browser approval resolution plus authoritative Run retry/rerun controls.
- [x] Add the hosted authenticated commercial session route and idempotent Clerk membership synchronization into the commercial store.
- [ ] Bind synchronized commercial organizations/memberships to kap-server's platform authorization store end-to-end.
- [ ] Add authorized WS deployment and replay/security integration tests.
- [ ] Perform an explicit, validated Prisma data migration only after mapping approval.
