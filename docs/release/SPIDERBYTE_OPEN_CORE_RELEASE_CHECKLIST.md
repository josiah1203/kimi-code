# SpiderByte Open Core release checklist

Status: release gate and evidence template. A green typecheck or a route
registration does not make a feature production-ready. The release owner must
record the command result and the exact artifact or log for every required
gate.

## Open Core release contract

The release is Open Core only when a clean checkout can install and run the
accountless local CLI/daemon with explicit customer-owned provider access. The
release must use `SpiderByte`, `spyderbyte`, `@spiderbyte/*`, and SpiderByte
Agent Core as its canonical identity. It must not require hosted SpiderByte
identity, hosted compute, billing, managed model access, enterprise services,
or an unreproducible browser bundle.

The current machine-readable status is
[`open-core.json`](../../open-core.json). It intentionally remains
`not-ready` until all required gates and external review inputs are present.

## Required clean-checkout gates

Run these from Node.js `24.15.0` and pnpm `10.33.0` after cloning the intended
revision. The order keeps installation and static authority checks ahead of
long-running tests:

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm run check:lint-policy
pnpm run sherif
pnpm run test
pnpm run build

pnpm run check:open-core
pnpm run check:branding
pnpm run check:package-names
pnpm run check:package-consistency
pnpm run check:docs-consistency
pnpm run check:legacy-runtime
pnpm run check:secrets
pnpm run generate:sbom
pnpm run check:sbom
pnpm run check:licenses
pnpm run smoke:local
pnpm run verify:package-artifacts
git diff --check
```

Run the focused boundary suites as separate evidence. They exercise local
fixtures and policy boundaries; they do not prove live provider, SSH host,
public OAuth, Docker, Kubernetes, or hosted-service availability:

```sh
bash scripts/verify-provider-cli-adapters.sh
bash scripts/verify-self-hosted-connections.sh
bash scripts/verify-ssh-boundary.sh
bash scripts/verify-plugin-mcp.sh
bash scripts/verify-commercial-seat-licensing.sh
bash scripts/verify-cross-workspace-authz.sh
bash scripts/verify-platform-slices.sh
bash scripts/verify-accountless-local.sh
```

The aggregate release runner records each result under
`.tmp/open-core-release-gates`:

```sh
pnpm run verify:open-core-release
```

Network-dependent provider, registry, tunnel, identity, payment, and vendor
tests must be labeled separately. A local mock or deterministic adapter cannot
be used as evidence for a production integration.

## Release evidence record

Before publication, attach the following to the release review:

| Evidence | Required result | Current checkout truth |
| --- | --- | --- |
| Clean install | Frozen lockfile install from the intended revision | Must be rerun in a clean environment; the current local dependency store is incomplete. |
| Package topology | Workspace, Nix, package map, Open Core, bins, and exports agree | Checked by `pnpm run check:package-consistency`; tarball checks remain separate. |
| Documentation | Local links and status claims agree with code | Checked by `pnpm run check:docs-consistency`; external deployment claims remain explicit. |
| Local smoke | Version, accountless auth, provider inventory, and capability inspection pass without provider credentials | `pnpm run smoke:local`; requires installed dependencies. |
| Typecheck/test/build | All supported packages pass | Not claimed until the clean-checkout gate completes. |
| Security and licensing | Secret scan, license policy, SBOM, and artifact review pass | Required; no external security audit is implied by repository scripts. |
| Package artifact | Packed CLI and libraries install without workspace-only sources | Required; source-checkout `dist` behavior is not package-install evidence. |
| Upgrade/rollback | Migration, snapshot restore, and previous-version fallback are rehearsed | Not implemented as an automated production controller. |

## Known blockers

- The browser frontend source is external to this repository; Open Core ships
  no generated browser bundle.
- Provider CLI adapters require customer configuration and live provider
  verification; SpiderByte does not provide model access by default.
- SSH, HTTP workers, Docker, Kubernetes, GPU, private-network, and tunnel
  deployments require customer-owned adapters and operational evidence.
- Commercial licensing and seat services have deterministic contracts and
  tests, but production identity, signing authority, durable storage, and
  operations remain adapter-dependent.
- Hosted identity, hosted compute, managed provider access, billing, public
  plugin OAuth, and enterprise control planes are unavailable in Open Core.
- A release must not be marked ready while any gate is unavailable because the
  local dependency installation is incomplete or because only mocks passed.

The appropriate status for an unverified capability is **unknown or requiring
external verification**, **adapter-dependent**, or **unavailable**—never
“implemented” merely because a type, route, placeholder, or test adapter
exists.
