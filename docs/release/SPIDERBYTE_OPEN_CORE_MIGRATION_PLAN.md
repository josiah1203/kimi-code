# SpiderByte Open Core migration plan

Status: historical planning baseline. The repository is not ready for
publication, and the current product/edition authority is
[`SPIDERBYTE_PRODUCT_AUTHORITY.md`](../architecture/SPIDERBYTE_PRODUCT_AUTHORITY.md).
The dated inventories and gates below are historical evidence; they must not
override current code facts or be read as proof that a planned capability is
implemented.

This document is a historical implementation plan for preparing the repository
for GitHub publication as SpiderByte Open Core. The current product and
edition authority is [`SPIDERBYTE_PRODUCT_AUTHORITY.md`](../architecture/SPIDERBYTE_PRODUCT_AUTHORITY.md).
This plan is deliberately separate from the final release report: a planned
gate is not a passed gate.

## 1. Release contract

The supported distribution is a clean-clone, accountless, self-hostable local
platform. Its canonical identity is:

| Concern | Required value |
| --- | --- |
| Product | SpiderByte |
| Executable | `spyderbyte` |
| Runtime | SpiderByte Agent Core |
| npm scope | `@spiderbyte/*` |
| Local mode | No hosted SpiderByte credential required |
| Provider mode | Local provider or explicit BYOK connection |
| Hosted Business capabilities | Excluded from this repository |

The implementation must not fabricate hosted identity, billing, managed
providers, hosted workers, Slack, Teams, or enterprise deployment services.
Those capabilities may have a documented extension boundary, but no hosted
implementation may be imported, registered, or required by Open Core.

`open-core.json` remains `not-ready` until every release gate in Section 12 is
green. No npm publication, GitHub push, PR, tag, or release is part of this
plan.

## 2. Baseline captured before implementation

Captured on 2026-08-10 from branch `main`, commit
`7f7932b417789e58a1af9e1affbd25528d184f82`. The worktree was clean. The
supported toolchain is Node.js `24.15.0` and pnpm `10.33.0`; the repository
contains 25 package manifests/workspace entries and 16 packages listed in the
current Open Core manifest.

The machine-readable authority is
[`config/spiderbyte-release-authority.json`](../../config/spiderbyte-release-authority.json),
and the historical baseline record is
[`SPIDERBYTE_OPEN_CORE_BASELINE.json`](./SPIDERBYTE_OPEN_CORE_BASELINE.json).
`pnpm run verify:phase-0` validates that the authority documents, structured
allowlists, package dispositions, inventory counts, and baseline audit counts
are reproducible from the checkout. The baseline is historical evidence; it
must not be replaced with a passing-only report after migration work begins.

| Gate or inventory | Baseline result | Interpretation |
| --- | ---: | --- |
| Open Core boundary | **20 blockers** | 13 commercial import/contract findings, 1 commercial implementation, 4 commercial public-contract findings, 1 missing web source, 1 stale generated bundle |
| Branding | **277 findings** | VS Code, CLI/docs, paths/env names, generated web assets, and legacy product language remain active |
| `pnpm run typecheck` | **PASS** | Current TypeScript graph typechecks; this does not prove the v2 migration or public behavior is complete |
| Focused platform slices | **104 tests, 2 sandbox-only failures** | Both failures were local listener `EPERM`; the same worker test passed elevated, 5/5 |
| `pnpm run lint` | **FAIL** | 47 errors and 3,015 warnings |
| `pnpm run test` | **FAIL / aggregate unavailable** | Cascading `EMFILE` watcher exhaustion followed independent v2, ACP, CLI/TUI, persistence, and MCP failures; the run was stopped after it ceased producing reliable aggregate signal |
| `pnpm run build` | **PASS** | Docs, packages, VS Code, CLI, search worker, and current web bundle build |
| CLI `npm pack --dry-run` | **PASS with wrong identity** | Packed the pre-migration upstream-scope CLI, 546 files, including the unreproducible `dist-web` bundle |
| CLI `npm publish --dry-run` | **PASS with warning** | Dry-run warns that registry login is required; it is not publication evidence |
| `pnpm run lint:pkg` | **PASS with warnings** | `publint` warns about import fallback and missing package types |
| `pnpm run sherif` | **FAIL** | One unordered dependency issue in `packages/kap-server/package.json` |
| Service naming audit | **PASS** | Existing service naming check is green |
| `git diff --check` | **PASS** | Baseline whitespace is clean |
| SBOM | **INCOMPLETE** | 118 manifest-level components; no purls, resolved licenses, bom refs, or dependency relationships |
| License/secret/package-name audits | **NO COMPLETE GATE** | Existing scripts do not provide the required release validation |

Important current facts that drive sequencing:

- `apps/spiderbyte/package.json` exposes both `spyderbyte` and the legacy
  `spyderbyte` binary, and still uses the pre-migration package identity.
- `packages/SpiderByte Agent Core` is the v2 engine, while the legacy v1 engine still
  exists as `packages/agent-core` and remains in the default workspace graph.
- The Node SDK still exposes v1-shaped harness APIs and v2 migration
  pressure valves, including `not_implemented` paths and an `engineAccessor`.
- `packages/SpiderByte Agent Core/src/workspace/commercial` is implemented and is
  re-exported through the core, server, and client surfaces.
- `apps/web` is absent, while `apps/spiderbyte/dist-web` contains 534 generated
  files and is currently packaged.
- The current SBOM generator explicitly describes itself as a manifest
  inventory rather than a resolved lockfile/license SBOM.

The exact commands used for this baseline were:

```sh
git status --short --branch
git log -1 --format='%H%n%ad%n%s' --date=iso-strict
node scripts/check-open-core-boundary.mjs --json
node scripts/check-branding.mjs
pnpm run verify:open-core-local
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
NPM_CONFIG_CACHE=/tmp/spiderbyte-npm-cache npm pack --dry-run
NPM_CONFIG_CACHE=/tmp/spiderbyte-npm-cache npm publish --dry-run
pnpm run lint:pkg
pnpm run sherif
node scripts/check-service-naming.mjs
git diff --check
```

## 3. Work breakdown and sequencing

### Phase 0 — Freeze authority and inventory

1. Keep the current baseline logs as CI artifacts or reproduce them in the
   first migration change; do not overwrite them with a passing-only report.
2. Make `PACKAGE_RENAME_MAP.md` and `OPEN_CORE_BOUNDARY.md` normative inputs
   for the inventory/package-disposition and boundary checkers. Their paths
   and required headings are declared in the machine-readable authority file.
3. Add machine-readable allowlists for intentional compatibility, provider,
   legal, and upstream-attribution references. Every entry must include a
   path, matched token, reason, owner, and removal/review date.
4. Add an inventory command that reports package names, workspace paths,
   exports, bins, public entry points, package dependencies, and generated
   assets. Run it with `pnpm run inventory:release`; the check form must fail
   on a package missing an intentional disposition.

**Exit criteria:** every workspace package and every legacy/public path is in
the rename map; baseline counts are reproducible; no implementation is changed
to reduce a count.

**Phase 0 completion record (2026-08-10):** `pnpm run verify:phase-0` passes.
The inventory reports 25 package manifests, 25 workspace entries, 16 current
Open Core entries, and 26 generated-asset paths with zero missing package or
legacy/public dispositions. The verifier reproduces the historical boundary
count of 20 and branding count of 277. Those findings remain release blockers;
Phase 0 records them and does not claim to resolve them. `open-core.json`
therefore remains `not-ready`.

### Phase 1 — Canonical package topology

Apply the moves in `PACKAGE_RENAME_MAP.md` as one dependency-graph migration:

1. Move the v2 engine to the canonical `packages/agent-core` path and publish
   it as `@spiderbyte/agent-core`.
2. Move the SDK to a role-based `packages/sdk` path and publish it as
   `@spiderbyte/sdk`; move the client facade to `packages/client` and publish
   it as `@spiderbyte/client`.
3. Move the CLI application to `apps/cli` and publish it as
   `@spiderbyte/cli`; its only supported bin is `spyderbyte`.
4. Rename all other publishable packages to `@spiderbyte/*`, preserving neutral
   technology names such as `kaos`, `kosong`, `minidb`, `pi-tui`, `protocol`,
   `telemetry`, `transcript`, and `tree-sitter-bash`.
5. Move v1 engine and legacy migration code under `compat/legacy-*`, outside
   `pnpm-workspace.yaml`, `flake.nix`, the default build graph, Open Core, and
   package exports. Initially retain it only as a private, explicitly
   deprecated migration aid; remove it completely once no supported migration
   command needs it.
6. Update package metadata, exports, path aliases, tsconfigs, lockfile,
   Changesets configuration, Nix workspace lists, release scripts, fixtures,
   examples, and all generated metadata. Use `git mv`; do not leave aliases in
   the default graph.
7. Add a package-name audit that checks directory/name/bin consistency,
   workspace references, dependency specifiers, exports, tarball package.json,
   and `npm pack --dry-run` output.

**Exit criteria:** no publishable package has a non-`@spiderbyte/*` name; no
default build path imports v1; `SpiderByte Agent Core` is absent as a canonical name;
`spyderbyte` is the only supported CLI executable; all target packages pack
with no private paths, credentials, stale bundle, or commercial source.

### Phase 2 — Make v2 the only supported runtime

Migrate the runtime from the edges inward, keeping the core contract as the
source of truth:

1. Remove `experimental-v2.ts` and `SPIDERBYTE_LEGACY_FLAG` from active code.
   The CLI, print mode, shell mode, web startup, ACP, VS Code, upgrade,
   authentication, provider configuration, replay/import, session management,
   and tool execution must all construct the canonical v2 runtime directly.
2. Remove legacy `spyderbyte`, `/provider`, `spyderbyte server`, `.spiderbyte`, and
   obsolete authentication/configuration paths from the supported surface.
   If a migration notice is necessary, implement it in the deprecated
   compatibility directory, not as a silent fallback.
3. Remove v1 imports from the SDK and adapters. Rename public symbols such as
   legacy harness APIs to SpiderByte-neutral names; do not keep a canonical export
   alias merely to hide a breaking migration.
4. Close every public SDK gap. The implementation order is:

   | Gap | Required v2 implementation | Required proof |
   | --- | --- | --- |
   | `deleteSession` | Durable lifecycle deletion, index cleanup, idempotent result, and event ordering | SDK, Klient, REST, restart, and deletion tests |
   | Custom SDK tool calls | Registered user-tool contract routed through the v2 interaction kernel | success, rejection, timeout, cancellation, and error-envelope tests |
   | Injected Kaos/tool support | Host capability injection through explicit v2 bootstrap interfaces | memory, IPC, and local host conformance tests |
   | Replay/import | Core-owned transcript import/replay operations with no v1 helper | round-trip, size limit, resume, and corruption tests |
   | `engineAccessor` | Replace every use with a typed facade or private bootstrap handle; remove public escape hatch | compile-time API assertion and IPC parity tests |
   | v1-only methods/types | Implement against v2 or remove from the supported SDK | generated declaration review and negative API tests |
   | Compatibility mappings | Keep only documented provider/protocol mappings with stable errors | allowlist and no-legacy-dependency tests |

5. Add a public-surface inventory test that fails if a method can return
   unconditional `not_implemented`, `executor-unavailable`, or a silent legacy
   fallback. Optional host capability failures must use stable documented error
   codes.

**Exit criteria:** the canonical CLI and SDK run without v1 imports, the
supported public declarations contain no unresolved stubs, and the same
capability behavior is available over memory, IPC, and supported browser
transport where advertised.

### Phase 3 — Branding and generated assets

1. Rename active product identity in constants, command registration, TUI/CLI
   output, telemetry, URLs, filesystem paths, VS Code metadata, desktop
   metadata, docs, examples, tests, snapshots, workflows, and release assets.
2. Treat `SpiderByte` and `spyderbyte` as distinct product-name and executable
   tokens, not two brands. Do not mechanically rewrite provider names such as
   OpenAI, Anthropic, Google, OpenRouter, Modal, or SpiderByte when they identify an
   external provider or legal upstream attribution.
3. Replace broad regex exceptions in the branding checker with the small
   structured allowlist from Phase 0. An exception must be path-specific and
   tested; archived history is excluded by path, not by hiding current source.
4. Resolve the browser source decision before changing generated assets:

   - preferred: recover `apps/web` legitimately and commit the authoritative
     source plus a reproducible sync/build command; or
   - fallback for this checkout: remove `apps/cli/dist-web` from the Open Core
     package and state that the browser client is external to this repository.
     The local REST/WebSocket server remains supported only where its contract
     is tested; `spyderbyte web` must not claim to serve a missing UI.

5. Rename or retire VS Code/desktop assets, marketplace references, screenshots,
   icons, and generated bundles. Rebuild all generated output from source or
   remove it from the distribution.

**Exit criteria:** `pnpm check:branding` reports zero unintentional findings;
there is no generated frontend without authoritative source; a clean tarball
contains only reproducible, correctly branded assets.

### Phase 4 — Enforce the Open Core boundary

1. Remove `packages/SpiderByte Agent Core/src/workspace/commercial` from the canonical
   engine. Move any hosted membership, entitlement, billing, metering, vault,
   managed-worker, or tenancy implementation to the excluded commercial
   repository/package, or delete it.
2. Remove commercial route registration and public leakage from:
   `packages/kap-server/src/routes/v2/platform.ts`,
   `packages/klient/src/contract/global/platform.ts`,
   `packages/klient/src/core/facade/global.ts`,
   `packages/klient/src/transports/memory/serviceRegistry.ts`, and all barrels.
3. Keep only provider-neutral extension points in Open Core. A local usage
   record, policy, budget, capability, or provider connection is allowed when
   it works without hosted authority; a hosted entitlement or commercial
   implementation is not.
4. Update `open-core.json` to describe the final package set and explicit
   exclusions. Do not list removed commercial paths as if they were safely
   quarantined in Open Core.
5. Strengthen the boundary checker to inspect source, package dependencies,
   exports, route registration, generated assets, and the transitive dependency
   graph. It must fail on a commercial implementation in an Open Core package,
   not merely on selected token strings.
6. Add boundary tests proving that local startup, memory transport, IPC
   transport, SDK exports, and server routes do not resolve commercial modules.

**Exit criteria:** `pnpm check:open-core` reports zero blockers without broad
suppression; no Open Core package imports a commercial package or registers a
commercial route; all public contracts are local/provider-neutral.

### Phase 5 — Local accountless product closure

1. Define the accountless bootstrap: local workspace, organization/project
   records, persistence root, local secret store, provider connection, policy,
   budget, usage, Run, artifact, and lineage services.
2. Verify local provider/BYOK operation with a deterministic stub and one
   documented local/OpenAI-compatible provider path. No hosted credentials are
   read by the smoke test.
3. Make local Runs, artifacts, lineage, policies, budgets, approvals, and usage
   durable and coherent across restart, replay, and error paths.
4. Make unsupported optional adapters fail deterministically with documented
   error envelopes. Remove dead routes and public contracts instead of leaving
   `not_implemented` methods in the supported API.
5. Add the accountless `spyderbyte` smoke path: start, create workspace,
   configure local/BYOK provider, execute a scripted Run, create/read artifact,
   evaluate policy and budget, restart, and inspect the result.

**Exit criteria:** a clean checkout can complete the local smoke path with no
SpiderByte hosted service, login, billing, or managed provider dependency.

### Phase 6 — OSS, supply chain, and release policy

Add and validate:

- `LICENSE`, `NOTICE`, third-party attribution, contributor/ownership,
  `SECURITY.md`, `CONTRIBUTING.md`, release, compatibility, and deprecation
  policies;
- architecture, local installation, provider/BYOK, migration, and Open Core
  boundary documentation in the supported documentation structure;
- a lockfile-resolved CycloneDX SBOM with purls, versions, licenses, bom refs,
  dependency relationships, provenance, and source ownership where available;
- a license policy that fails unknown or incompatible dependencies and records
  the review for bundled native/web assets;
- secret scanning over tracked source, generated assets, tarballs, and CI
  configuration;
- reproducible build instructions, artifact checksums, provenance/attestation,
  and signing verification. Do not label artifacts signed or attested until a
  verifier succeeds;
- clean-machine installation, packed-package installation, upgrade rehearsal,
  and rollback rehearsal using isolated temporary directories.

Replace the current manifest-only `scripts/generate-sbom.mjs` with a pinned,
lockfile-aware generator and a separate validator. The generated file must be
deterministic apart from an explicitly documented timestamp/serial policy.

**Exit criteria:** SBOM, license, ownership, secret, provenance, and signing
checks all produce machine-verifiable results and no unresolved warning is
presented as non-blocking.

### Phase 7 — CI and clean-checkout gates

Create a dedicated pull-request workflow, or extend CI without weakening
existing jobs, with jobs for:

1. clean checkout and frozen dependency installation;
2. formatting/diff check, lint, and typecheck;
3. unit, integration, SDK, Klient, CLI/TUI, and local accountless smoke tests;
4. Open Core boundary, branding, package-name, and legacy-runtime audits;
5. secret, SBOM, license, ownership, and artifact-provenance checks;
6. package tarball validation and packed-package install tests;
7. documentation link and build-artifact validation.

Tests that require live OpenRouter, Modal, Slack, Teams, billing, hosted
identity, or an external web source must be labeled commercial/external and
must not be part of the Open Core pass condition.

**Exit criteria:** CI runs the same commands as the clean-checkout checklist,
uses the repository's Node/pnpm versions, preserves failure logs as artifacts,
and has no repository-owner-specific condition that would skip Open Core gates.

### Phase 8 — Final audit and handoff

1. Re-run every baseline command and the complete Phase 7 workflow locally.
2. Generate `docs/release/SPIDERBYTE_OPEN_CORE_RELEASE_REPORT.md` only after
   all required gates have evidence. It must include baseline-to-final counts,
   package map, retired/retained compatibility paths, excluded commercial
   capabilities, exact commands, and known limitations.
3. Set `open-core.json.graduation_status.status` to `ready` only when all
   results are machine-verifiable and no blocker is disguised as a warning.
4. Run `git status --short` and `git diff --staged --stat` before handoff. Do
   not create a commit, PR, push, npm publication, or release tag.

## 4. Gate matrix

| Gate | Command/artifact | Required final result |
| --- | --- | --- |
| Install | `pnpm install --frozen-lockfile` in a clean checkout | Pass with no workspace-only dependency required at runtime |
| Typecheck | `pnpm run typecheck` plus public declaration checks | Pass |
| Lint | `pnpm run lint`, `pnpm run sherif`, `git diff --check` | No errors; warnings either zero or explicitly validated and owned |
| Tests | `pnpm run test` plus split deterministic integration suites | Pass; performance benchmarks isolated and green under a documented budget |
| Build | `pnpm run build` | Pass with reproducible source-backed assets |
| Boundary | `pnpm check:open-core` | 0 blockers |
| Branding | `pnpm check:branding` | 0 unintentional findings |
| Package names | new package-name audit | 0 unresolved findings |
| Legacy runtime | new v1/import/stub audit | 0 active legacy dependencies or supported stubs |
| Local product | accountless smoke script | Pass without hosted credentials |
| Packaging | `npm pack --dry-run`, `npm publish --dry-run`, unpack/install each target tarball | Pass; no private paths, credentials, stale bundles, or commercial code |
| SBOM | resolved CycloneDX file plus validator | Pass with purls, licenses, relationships, provenance |
| Licensing | license/NOTICE/attribution validator | Pass |
| Security | secret scanner and dependency vulnerability review | Pass or explicitly documented fixed waiver with expiry |
| Provenance | artifact checksum/signature/attestation verification | Pass only where verification succeeds |
| Documentation | link checker and docs build | Pass in supported locales |
| Release report | `SPIDERBYTE_OPEN_CORE_RELEASE_REPORT.md` | No unresolved blocker or disguised warning |

## 5. Safe execution rules

- Preserve unrelated user changes and inspect `git status` before every batch.
- Use narrow `git mv`/patches and reversible commits during implementation;
  never use history rewriting or broad recursive deletion.
- Keep compatibility code out of the default graph and mark it with an owner,
  deprecation message, and removal version/date.
- Do not broaden allowlists to make audits green. Fix the source or remove the
  unsupported surface.
- Do not generate a Changeset with a major bump without explicit user
  confirmation; the package identity/API migration is a likely breaking
  release and must be resolved before release preparation.
