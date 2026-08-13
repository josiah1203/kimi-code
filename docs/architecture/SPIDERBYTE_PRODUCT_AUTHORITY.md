# SpiderByte product authority

Status: normative current product and edition authority. This document is
the strategic source of truth for product identity, supported deployment
modes, commercial direction, provider integration, and plugin boundaries.
It does not turn a contract, adapter, route, or plan into a working feature.
Implementation status must still be established from code and verification
evidence.

## Canonical identity

The official product name is **SpiderByte**. The canonical executable is
`spyderbyte`, and the public npm namespace is `@spiderbyte/*`. The runtime
identity is SpiderByte Agent Core in `packages/agent-core`.

The alternate capitalized spelling is not adopted as product branding. Existing
internal `Spyderbyte*` TypeScript symbols and `SPYDERBYTE_*` environment names
are retained only as compatibility identifiers where changing them would
break an existing API or configuration surface. New public APIs, documents,
and package names must use SpiderByte, `spyderbyte`, and `@spiderbyte/*`.

## Edition contract

| Edition | Intended ownership model | Accepted scope | Current repository status |
| --- | --- | --- | --- |
| Open Core | Individual or developer owns the machine, data, credentials, and execution | Local/accountless runtime, local persistence, configured provider access, CLI/TUI, SDK, REST/WebSocket, ACP, MCP, and Otis local integration | Implemented local surface; release gates still apply |
| Self-hosted commercial | Customer owns the infrastructure, data, provider accounts, and operational boundary | Seat-based commercial entitlements, organization/team administration, policy and audit controls, support/update channels, and optional customer-managed remote execution | Signed offline-license verification and deterministic seat lifecycle exist in `commercial/licensing`; production identity, signing authority/key distribution, control-plane deployment, and operational license management remain incomplete |
| Hosted SpiderByte | SpiderByte operates the control plane or compute service | Optional future hosted identity, managed compute, hosted storage, and hosted provider operations | Not a launch dependency and not implemented as a production service in this checkout |

The commercial launch model is seat-based. Customers pay their own model
providers, cloud/GPU providers, storage, and network operators. Hosted
SpiderByte compute and model-usage billing are deferred optional products; they must not be
presented as required for the individual or self-hosted commercial launch.
SpiderByte does not provide model access by default: customers configure their
own provider CLIs or APIs. Customers provide their own infrastructure.

## Customer-owned deployment modes

The supported product direction is customer-owned execution. The following
modes are targets of the same local/provider-neutral contract:

| Mode | Product intent | Current evidence |
| --- | --- | --- |
| Local workstation | Run the CLI/TUI and local server on one machine | Implemented and verified by the local Open Core graph and local test suites |
| Customer VM or private server | Run a SpiderByte daemon on infrastructure controlled by the customer | Workspace-scoped target records, governed SSH transport, host-key verification, bounded semantic frames, health/capability checks, version observations, and revocation exist; the remote daemon executable remains customer-installed and operationally unverified here |
| Customer GPU, cloud, or cluster | Delegate work to customer-owned compute | Customer-managed HTTP worker execution and target leases exist locally; isolation, scheduling, cleanup, and provider-backed operations remain incomplete |
| Docker or Kubernetes deployment | Package the customer-owned daemon and its dependencies | Target types and adapter-dependent status are represented; deployment manifests, transport adapters, upgrade/rollback, and operational verification remain incomplete |

Customer-owned deployments keep customer data and provider credentials within
the customer-controlled boundary. A SpiderByte-operated identity, compute
broker, or model proxy is not required for the self-hosted commercial edition.

## Local trust and credential boundary

Local Open Core is an accountless, same-user trust boundary. The loopback
server bearer token protects the local API from other local processes, while
`spyderbyte mcp` over stdio trusts the process that owns its stdin/stdout; it
does not create a hosted user identity. Streamable HTTP MCP is protected by the
same bearer boundary as REST and WebSocket. `--dangerous-bypass-auth` is
accepted only for loopback binds and is rejected for LAN/public exposure.
Within that local boundary, organization and project reads are filtered by the
server-derived local actor and bound workspaces require project membership; an
unbound workspace remains available under the explicit accountless local trust
exception.

Customer-managed HTTP worker endpoints are resolved and validated before
health or execution requests. Customer-managed workers cannot resolve to
private network addresses; private gateways may use customer-private ranges
but not loopback or link-local addresses. Approved DNS answers are pinned for
the request and redirects are rejected.

Provider-connection credentials are held behind opaque references and
persisted as authenticated AES-256-GCM envelopes. `SPIDERBYTE_SECRET_STORE_KEY` is an
operator-supplied 32-byte key and is intentionally not persisted beside the
ciphertext. Without it, credential creation and plaintext migration fail
closed. This protects stored files from disclosure at rest, but does not
protect a same-user process that can read the live SpiderByte process memory;
hosted identity, tenant isolation, KMS, and centralized revocation remain
outside Open Core.

The compatibility model-catalog route accepts a transient `api_key` request
field for local setup, but stores only an opaque secret reference and never
returns the raw value. Legacy `providers.*.api_key` config entries are migrated
through the encrypted store during bridge startup; migration fails closed when
`SPIDERBYTE_SECRET_STORE_KEY` is unavailable. The remaining release gate is
verification of every transport and clean-install migration path.

Workspace platform lifecycle events include a SHA-256 previous-hash/event-hash
chain. New journal loads fail closed on a broken chain; pre-chain legacy
events are bridged into the first current hash but are not represented as
historically tamper-evident. This is local evidence integrity, not a remote
append-only audit authority or an independently trusted security log.

## Provider CLI model

SpiderByte’s product direction is orchestration of user-configured provider
CLIs and local/customer-managed runtimes, not a mandatory SpiderByte model
gateway or proxy. A provider CLI adapter must explicitly define discovery and
version checks, model listing/capabilities, machine-readable request and
response formats, streaming, cancellation, timeout behavior, retry/error
classification, usage reporting, and secret/log redaction.

The repository already contains provider-neutral API abstractions and direct
provider adapters in `packages/kosong`, `packages/oauth`, and
`packages/agent-core/src/workspace/providerConnections`. The generic configured
provider-command adapter is implemented in
`packages/kaos/src/provider-command.ts` and is exposed locally through
`spyderbyte providers`, `spyderbyte provider detect`,
`spyderbyte provider test`, and `spyderbyte capabilities`.

An explicit `provider-cli` ProviderConnection also routes governed model
requests through the same adapter, records normal provider invocation and
usage events, and rejects tool/structured-output requests that the command
contract cannot carry.

This capability remains adapter-dependent and incomplete as a commercial
product integration: it requires explicit command metadata and customer-owned
credentials or CLI login state, and does not claim built-in support for Codex,
Claude, Kimi, Ollama, or any other named provider. Those names remain examples
of the adapter boundary until provider-specific command contracts are verified
against live vendor CLIs.

The configuration is an array. `runArgs` is argv-only and may contain the
`{model}` placeholder; the prompt is sent through stdin. Provider commands
must emit JSONL run events (`text`, `usage`, `metadata`, and `done` are
supported) and JSON or JSONL model output:

```sh
export SPYDERBYTE_PROVIDER_CLI_CONFIG='[
  {
    "id": "customer-cli",
    "displayName": "Customer Provider CLI",
    "executable": "/absolute/path/to/provider-cli",
    "versionArgs": ["version", "--machine"],
    "modelsArgs": ["models", "--json"],
    "runArgs": ["run", "--json", "--model", "{model}"],
    "input": "jsonl",
    "modelsOutput": "json",
    "environment": {"PROVIDER_API_KEY": "YOUR_API_KEY"}
  }
]'
```

The CLI reports configured executable paths, versions, model records,
capabilities, and classified failures. Configured environment values are
passed to the provider child process, but secret-looking values and bearer
tokens are redacted from adapter diagnostics. This is not a secret store or a
provider authentication implementation; provider-specific login remains the
provider CLI's responsibility.

For governed runtime use, create a `provider-cli` ProviderConnection whose
`metadata.provider_command` uses the snake-case form of the same contract,
whose `metadata.model` names the selected model, and whose `secret_ref` is an
opaque platform secret. If a stored secret must be exposed to the child
process, set `metadata.provider_command.auth_env` to its environment-variable
name. `secret_none` is allowed only for a CLI that authenticates through its
own local login state. The runtime executes locally through `LocalKaos`; it
does not turn the command into an unrestricted shell or install the vendor
CLI.

## Plugin architecture

Otis is the local headless MCP/plugin integration. Its canonical local path is
`spyderbyte mcp` over stdio; authenticated Streamable HTTP at `/mcp` may be
used to connect an external client to a customer-controlled daemon. The
plugin exposes semantic, capability-checked operations over the existing
SpiderByte services. It must not grant arbitrary shell, SSH, filesystem, or
network access merely because an MCP client is connected.

The plugin does not require SpiderByte-hosted compute. A public hosted plugin,
ChatGPT UI resource, or SpiderByte-operated HTTPS endpoint remains an
external deployment and publication task, not an Open Core capability.
Plugin access operates through the customer’s SpiderByte daemon, and arbitrary
shell execution is not exposed by default.

## Authority hierarchy

When product language conflicts, use this order:

1. This document for product identity, editions, deployment direction, provider
   CLI strategy, and plugin positioning.
2. `OPEN_CORE_BOUNDARY.md` for the technical Open Core inclusion/exclusion
   boundary.
3. `PACKAGE_RENAME_MAP.md` and `config/spiderbyte-release-authority.json` for
   package topology and machine-readable release authority.
4. The release-readiness matrices for capability evidence and external gates.
5. Historical ADRs, migration plans, and audit snapshots as dated evidence,
   never as newer product decisions.

## Current release truth

The repository can represent and verify a local Open Core release candidate.
The self-hosted commercial edition and provider CLI adapter registry remain
incomplete until their operational acceptance gates pass. Signed offline
license verification and deterministic seat enforcement are implemented but
production key issuance, identity integration, durable deployment, and
operational acceptance remain adapter-dependent. Any hosted edition remains
unavailable. SSH is a
governed transport adapter, but it is adapter-dependent in deployment because
the customer must install a compatible `spyderbyte daemon platform-worker
--stdio` executable on the remote host. The local connection manager is a
workspace-scoped registry and health-check surface; it is not proof that every
declared transport type is executable.
