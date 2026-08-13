# SpiderByte self-hosted operations

Status: normative operational guide for the current checkout. This guide
describes the supported local Open Core boundary and the evidence required for
customer-owned commercial deployment. A route, type, adapter, or plan record
is not treated as a working deployment unless the corresponding implementation
and verification evidence exists.

## Clean local installation

SpiderByte requires Node.js `24.15.0` or newer and pnpm `10.33.0`. From a clean
checkout, run the bootstrap rehearsal:

```sh
bash scripts/bootstrap-clean-checkout.sh
```

The script runs `pnpm install --frozen-lockfile`, then checks package topology
and release-critical documentation. It does not create an account, contact a
model provider, or deploy a service. For the source checkout, use the canonical
CLI runner:

```sh
pnpm --filter @spiderbyte/cli run dev:cli-only -- --version
pnpm run smoke:local
```

The canonical executable is `spyderbyte`; the canonical npm scope is
`@spiderbyte/*`; the runtime is SpiderByte Agent Core in
`packages/agent-core`. The local mode is accountless. `spyderbyte auth status`
reports that hosted SpiderByte identity is excluded rather than simulating a
login.

Local governance reads are scoped to the server-derived local actor. Project-
bound workspace routes and MCP operations require project membership; only an
unbound workspace uses the documented accountless local trust exception.

## Provider setup

SpiderByte does not provide model access by default. Customers configure their
own provider CLIs or APIs and supply the endpoint and credentials inside the
customer-controlled boundary. Hosted SpiderByte compute is not required for
local or self-hosted operation. Customers provide their own infrastructure.

For a direct local or BYOK API connection, use the interactive configuration
surface or a provider record. The exact provider fields are documented in
[provider configuration](../en/configuration/providers.md) and the command
reference. For an explicitly configured provider CLI, set
`SPYDERBYTE_PROVIDER_CLI_CONFIG` to a JSON array and inspect it without
guessing commands:

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
    "modelsOutput": "json"
  }
]'
spyderbyte providers --json
spyderbyte provider detect --json
spyderbyte provider capabilities --json
spyderbyte provider test customer-cli --model YOUR_MODEL --prompt "health check"
```

The provider-command adapter is **implemented but incomplete** and
**adapter-dependent**: it runs through `LocalKaos`, requires an explicit
configuration, and does not install or authenticate a vendor CLI. A governed
`provider-cli` ProviderConnection uses the same adapter for model selection,
model requests, model discovery, cancellation, usage recording, and Run/
Attempt trace context. It intentionally rejects tool calls and structured
response formats because the common command contract is text-only. Provider
names in the catalog identify external protocols; they are not SpiderByte
model access. Direct provider adapters and the OpenRouter protocol boundary
have controlled tests, but live vendor availability, credentials, quotas, and
production error behavior require external verification.

Provider-specific OAuth is **unavailable** in Open Core. API keys and provider
CLI login state remain customer responsibilities. Do not put secrets in argv,
repository files, MCP configuration, or provider diagnostics.

## Customer-owned deployment modes

`spyderbyte web` runs the local REST/WebSocket daemon. It binds to loopback by
default and uses the local bearer-token boundary:

```sh
spyderbyte web --host 127.0.0.1 --port 58627 --no-open
```

The browser frontend is external to this checkout. No generated browser bundle
is part of the Open Core release. The local daemon, SDK, client facade, ACP,
and local MCP are the supported integration surfaces here.

The compatibility folder-picker routes (`/api/v1/fs:browse`, `fs:home`,
`fs:content`, and `fs:mkdir`) operate on arbitrary host paths and are enabled
only for loopback daemons. A non-loopback daemon returns a policy-denied
envelope for those routes; use the workspace-scoped filesystem routes for
authorized workspace access.

| Deployment mode | Status | Evidence and operator responsibility |
| --- | --- | --- |
| Local workstation | Implemented and verified | `apps/cli`, `packages/agent-core`, `packages/kap-server`, local persistence, and accountless tests. |
| Customer VM or private server | Adapter-dependent | The local daemon and governed SSH transport exist; the customer installs and verifies the matching remote daemon and operating environment. |
| Customer-managed HTTP worker or private gateway | Adapter-dependent | Target and worker contracts exist; endpoint deployment, TLS, identity, isolation, capacity, and failure operations are external. |
| Docker deployment | Unavailable as a product deployment | The checkout has no SpiderByte daemon Docker Compose or release image manifest. `packages/client/Dockerfile` is a client E2E fixture, not a supported server distribution. |
| Kubernetes deployment | Unavailable | No Kubernetes manifests, Helm chart, operator, rollout, or rollback controller is present. |
| Customer GPU or cluster | Adapter-dependent | A target can describe customer-managed execution, but this checkout has no GPU scheduler, quota controller, image registry, driver validation, or hosted compute service. |

### SSH execution target

SSH is a governed transport to a customer-owned SpiderByte daemon. It is not
an arbitrary shell bridge. Register a target with an explicit host-key
fingerprint, confined remote root, workspace scope, and opaque credential
reference:

```sh
spyderbyte connections add \
  --workspace wd_example \
  --name customer-ssh \
  --type ssh \
  --ssh-host runner.example.test \
  --ssh-user spiderbyte \
  --ssh-host-key YOUR_SHA256_HEX_FINGERPRINT \
  --ssh-root /srv/spiderbyte/workspaces/example \
  --auth-method ssh_agent
```

The remote program is the fixed command
`spyderbyte daemon platform-worker --stdio`. The transport verifies the
protocol and host key, scopes the workspace, and exchanges bounded semantic
frames. Private key material is not accepted on the command line or in the
target record. **Arbitrary SSH is not exposed by default.** The transport is
**adapter-dependent** until the remote daemon, host policy, network path, and
operational tests are supplied by the customer.

### Docker deployment

Docker deployment is **unavailable**, not a hidden feature flag. There is no
release `Dockerfile`, Compose stack, image-publishing workflow, persistent
volume contract, health/readiness policy, migration job, or upgrade/rollback
procedure for the SpiderByte daemon in this checkout. A customer may build a
private image around the local daemon, but that is a private integration and
must be verified separately before it is represented as supported.

### Kubernetes deployment

Kubernetes deployment is **unavailable**. No Helm chart, Deployment, Service,
Ingress, Secret, PersistentVolume, Job, NetworkPolicy, PodDisruptionBudget,
autoscaling policy, or operator is shipped. A future deployment must define
identity, tenant/workspace isolation, persistent storage, migrations, worker
leases, graceful cancellation, observability, backup, restore, and rollback
before it can be called production-ready.

### GPU configuration

GPU execution is **adapter-dependent** and not hosted by SpiderByte in this
checkout. There is no repository-owned GPU scheduler, accelerator inventory,
driver/container validation, cost estimator, quota enforcer, or idle-resource
terminator. A customer-managed GPU target may be described through the
execution-target boundary, but the customer must supply the worker image,
runtime, drivers, limits, network policy, data locality, and cleanup process.

### Private network and tunnel setup

Private networking and tunnels are external deployment concerns. For a local
developer-mode MCP connection, expose only the authenticated `/mcp` route
through a customer-controlled HTTPS reverse proxy or short-lived private
tunnel. Keep the daemon on loopback and keep bearer authentication enabled:

```sh
SPIDERBYTE_MCP_PROFILE=curated spyderbyte web --host 127.0.0.1 --no-open
```

The repository does not ship a tunnel client, reverse proxy, TLS certificate
authority, private DNS, firewall policy, or production ingress. The
`--dangerous-bypass-auth` option is for loopback-only development and must not
be used for a LAN, tunnel, or public endpoint.

HTTP execution-target health checks and dispatch resolve hostnames before the
request, reject customer-managed targets that resolve to private addresses,
reject loopback/link-local destinations for private gateways, reject redirects,
and pin the approved DNS answers for the connection. DNS, TLS, ingress, and
customer firewall policy remain deployment responsibilities.

## ChatGPT and Codex plugin setup

Plugin access operates through the customer’s SpiderByte daemon. The local
Otis plugin uses the curated stdio surface:

```sh
spyderbyte mcp --profile curated
```

Codex setup is documented in
[`plugins/otis/docs/CODEX_SETUP.md`](../../plugins/otis/docs/CODEX_SETUP.md).
ChatGPT Developer Mode can connect only to a customer-supplied authenticated
HTTPS `/mcp` endpoint; see
[`plugins/otis/docs/CHATGPT_SETUP.md`](../../plugins/otis/docs/CHATGPT_SETUP.md).

The MCP server exposes semantic, capability-checked operations. It does not
grant arbitrary shell, SSH, filesystem, or network access. Public plugin
listing, ChatGPT UI resources, plugin OAuth, protected-resource metadata,
authorization-server discovery, scope issuance, PKCE, and a SpiderByte-hosted
HTTPS service are **unavailable** in this checkout. The customer must provide
and verify those services before publishing a public integration.

## License activation, seats, and entitlements

Open Core has no account login, paid entitlement, payment provider, or license
activation command. The `commercial/licensing` package contains an Ed25519
offline-license verifier and deterministic activation/seat lifecycle service;
it is **implemented but incomplete** and excluded from Open Core publication.
Production key issuance, signing authority, key rotation, identity, durable
commercial storage, deployment, revocation operations, and support processes
are **adapter-dependent**.

Commercial plans are seat-based. The commercial code contains data-shaped
Free, Team, Business, and Enterprise plan/entitlement records, but those
records are not a public price sheet and do not activate a service in this
checkout. Seat assignment, revocation, expiry, grace periods, idempotency, and
fail-closed capability checks are locally testable service behavior; they are
not evidence of a deployed commercial control plane. There is no supported
Open Core command that can purchase, activate, renew, or cancel a commercial
plan.

## Security and data flow

The intended local data flow is:

```text
user / local MCP client
        -> spyderbyte CLI or loopback daemon
        -> local workspace, policy, budget, Run/Attempt, and artifact stores
        -> explicitly configured provider API/CLI or customer-owned execution target
        -> bounded result, usage metadata, transcript, and artifact projection
```

SpiderByte does not provide model access by default and does not operate a
managed provider proxy in Open Core. Provider credentials are resolved through
local secret references and authenticated AES-256-GCM storage when the local
secret-store key is configured. `SPIDERBYTE_SECRET_STORE_KEY` must be backed up
separately from `SPIDERBYTE_HOME`; losing it makes encrypted local credentials
unrecoverable. The compatibility model catalog accepts a transient `api_key`
input for setup, migrates legacy `providers.*.api_key` entries at bridge
startup, and never returns raw credentials. Clean-install and full transport
verification remain release gates.

The loopback bearer token protects the local HTTP boundary from other local
processes. Stdio MCP trusts the process that owns stdin/stdout and does not
create a hosted identity. Tenant isolation, centralized key management,
tamper-resistant remote audit, content moderation, vendor security review, and
incident response require an external commercial or hosted deployment.

## Upgrade, rollback, backup, and restore

For a source checkout, upgrade by changing to the intended revision and
repeating the frozen bootstrap and release gates. Do not run a partial package
install against a live production data root:

```sh
pnpm install --frozen-lockfile
pnpm run check:package-consistency
pnpm run check:docs-consistency
pnpm run smoke:local
```

Rollback is a deployment procedure, not a CLI capability in this checkout.
Keep the previous executable/container and a verified data snapshot, stop
workers before changing versions, rehearse migrations on a copy, and restore
only after validating compatibility. The repository has no automated
production rollback controller.

There is no repository-provided backup or restore service. Operators must
snapshot the selected `SPIDERBYTE_HOME` (or customer deployment volume), the
provider configuration and encrypted credential records, and the secret-store
key through separate protected procedures. Test restore into an isolated data
root, run `spyderbyte doctor`, inspect workspace/run/artifact counts, and only
then switch traffic. Commercial SQL backups, object storage retention, legal
holds, and disaster recovery are external deployment responsibilities.

## Unsupported and adapter-dependent capabilities

| Capability | Status | What evidence would be required |
| --- | --- | --- |
| Local accountless CLI/TUI and daemon | Implemented and verified | Clean-checkout bootstrap, local smoke, focused tests, and release gates. |
| Provider CLI adapter and governed `provider-cli` connection | Implemented but incomplete / adapter-dependent | Live vendor command contract, credentials, retries, usage, redaction, provider outage tests, and self-hosted operational evidence. |
| Direct provider APIs | Adapter-dependent | Customer credentials, live endpoint verification, rate-limit/retry evidence, and provider terms review. |
| OpenRouter managed access | Unavailable as a SpiderByte-managed service | Customer-owned API access and explicit local configuration; no SpiderByte proxy is supplied. |
| Governed SSH target | Adapter-dependent | Compatible remote daemon, host-key verification, network, isolation, and recovery rehearsal. |
| Docker/Kubernetes/GPU hosting | Unavailable or adapter-dependent | Release manifests, image/provenance scans, persistent storage, quotas, scheduling, observability, and rollback. |
| Commercial license and seats | Implemented but incomplete / adapter-dependent | Production identity, signing authority, durable store, key rotation, activation/revocation operations, and audit retention. |
| Billing, invoices, taxes, refunds, and overages | Unavailable in Open Core | A selected payment/invoicing provider and reconciled production deployment. |
| Public ChatGPT/Codex plugin OAuth | Unavailable | Public HTTPS service, OAuth authority, scopes, PKCE, privacy/support metadata, and external publication review. |
| Hosted SpiderByte compute and model usage billing | Unavailable | SpiderByte-operated control plane, worker fleet, metering, storage, billing, security, and operations. |

These statuses are also represented in
[`open-core.json`](../../open-core.json), the product authority, and the
[Open Core release checklist](./SPIDERBYTE_OPEN_CORE_RELEASE_CHECKLIST.md).
