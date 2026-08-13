# ADR-0001: Establish one platform contract authority

- **Status:** Accepted historical decision; current product authority is
  [`SPIDERBYTE_PRODUCT_AUTHORITY.md`](./SPIDERBYTE_PRODUCT_AUTHORITY.md)
- **Date:** 2026-08-08
- **Scope:** SpiderByte Platform Enhancement Program, PEP-01
- **Base commit:** `01c74e9372fcbbbe99614e859b53b505ed1664a8`

## Context

The enhancement program adds durable Runs, artifacts, policies, provider
connections, resources, usage, and execution targets while preserving the
existing SpiderByte CLI, TUI, session behavior, and client integrations. The current
repository already contains several compatible but different boundaries:

- `packages/agent-core` owns the in-process agent and session runtime.
- `packages/protocol` owns the existing REST and WebSocket wire schemas.
- `packages/client` provides the contract-driven client facade.
- `packages/sdk` exposes the public harness and SDK API.
- `packages/kap-server` exposes daemon routes and replayable session events.

Without an explicit authority, platform features could create a second session
store, duplicate the agent loop, or let individual clients invent incompatible
Run and usage semantics.

## Decision

1. `packages/agent-core` remains the only runtime and session authority. The
   enhancement program adds platform services around it; it does not introduce
   another agent engine or session lifecycle.
2. `packages/protocol` is the canonical public contract authority. Platform
   entities, lifecycle states, command acknowledgements, machine-readable
   events, and compatibility fixtures are defined there before implementation
   code consumes them.
3. `packages/client` is the canonical typed client facade. CLI, TUI, SDK,
   ACP, VS Code, REST, and WebSocket adapters consume the same contracts rather
   than importing agent-core internals.
4. `packages/sdk` preserves its current API by adapting platform contracts
   to the existing SpiderByte session and harness types. Existing sessions remain
   readable without a storage rewrite.
5. A platform `AgentSession` is the durable conversational container and a
   `Run` is the durable unit of work inside it. An existing SpiderByte `Session` maps
   to an `AgentSession` with an implicit Run when no explicit Run record exists.
6. A provider `Connection` is distinct from the existing live WebSocket
   connection resource. Provider connections are therefore namespaced in new
   APIs and contain secret references only; they never contain API keys, OAuth
   tokens, leases, or other credential material.
7. Every accepted platform command returns a request id and durable object id.
   Lifecycle events carry the entity id, workspace id, actor, timestamp, and a
   monotonically increasing sequence so clients can reconnect and replay.
8. The existing v1 routes and wire shapes remain compatible. New platform
   routes and fields are introduced behind versioned endpoints or feature flags
   until migration is complete.

## PEP-01 contract boundary

The first implementation slice adds the platform schemas in
`packages/protocol/src/platform.ts`, exports them from the package entry point,
and adds fixtures that verify lifecycle, replay, secret-redaction, and usage
invariants. This slice intentionally adds no runtime behavior or storage.

The initial contracts cover:

- Workspace and AgentSession projections
- Run and Run plan steps
- immutable/versioned Artifacts and Resource references
- Provider Connections
- Resources
- Policy Decisions and capability outcomes
- customer-facing Usage Records
- Execution Targets
- lifecycle events and command acknowledgements

## Consequences

This creates a small amount of adapter work because legacy `Session`, provider
configuration, and live WebSocket connection types cannot be renamed in place.
That cost is intentional: it keeps existing clients stable while making the
new platform semantics explicit and testable. Runtime persistence, REST/WS
routes, and client methods will be added in later PEPs only after these
contracts are reviewed and versioned.

## Rejected alternatives

- **Rewrite the SpiderByte session engine:** rejected because it creates a second
  authority and risks breaking the CLI/TUI interaction model.
- **Expose `packages/agent-core` internals directly to clients:** rejected because it
  couples every client to runtime implementation details.
- **Reuse the existing live `/connections` resource for provider credentials:**
  rejected because it conflates WebSocket transport state with customer-owned
  provider access and creates a security boundary error.
- **Represent customer usage with token or tool counters:** rejected because
  the PRD requires customer-facing Intelligence and execution meters that are
  independent from internal model telemetry.
