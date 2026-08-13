# Changesets

This repository uses [Changesets](https://github.com/changesets/changesets)
to manage versions and release metadata for the public SpiderByte packages.

## Package publishing strategy

Publishing is independent and manually selected: include only the public
package(s) whose user-visible behavior, API, dependencies, or release artifact
changed. The current public package manifests are:

| Package | Directory | Description |
| --- | --- | --- |
| `@spiderbyte/cli` | `apps/cli` | Canonical CLI/TUI; installs the `spyderbyte` executable |
| `@spiderbyte/acp-server` | `packages/acp-server` | Local Agent Client Protocol server |
| `@spiderbyte/agent-core` | `packages/agent-core` | SpiderByte Agent Core runtime |
| `@spiderbyte/client` | `packages/client` | Contract-driven client facade |
| `@spiderbyte/kaos` | `packages/kaos` | Execution-environment abstraction |
| `@spiderbyte/kap-server` | `packages/kap-server` | Local REST/WebSocket server |
| `@spiderbyte/kosong` | `packages/kosong` | LLM/provider abstraction |
| `@spiderbyte/minidb` | `packages/minidb` | Embedded persistence and search |
| `@spiderbyte/oauth` | `packages/oauth` | Provider-neutral OAuth/token utilities |
| `@spiderbyte/pi-tui` | `packages/pi-tui` | Terminal UI package |
| `@spiderbyte/protocol` | `packages/protocol` | Local wire contracts |
| `@spiderbyte/sdk` | `packages/sdk` | Public TypeScript SDK and harness |
| `@spiderbyte/telemetry` | `packages/telemetry` | Client-side telemetry infrastructure |
| `@spiderbyte/transcript` | `packages/transcript` | Transcript data layer |
| `@spiderbyte/tree-sitter-bash` | `packages/tree-sitter-bash` | Deterministic bash parser |

Private applications are excluded in `.changeset/config.json`. Compatibility
and commercial workspaces are not public release targets. Do not add a
changeset for them unless a public package is also affected.

The published artifact must not depend on excluded commercial or compatibility
packages. Dependency impact must be reviewed manually when a public package
bundles another workspace package.

## Examples

| Change | Changeset selection |
| --- | --- |
| CLI/TUI behavior change | `@spiderbyte/cli` |
| SDK capability or public API change | `@spiderbyte/sdk` |
| SDK behavior also changes the CLI | Both `@spiderbyte/sdk` and `@spiderbyte/cli` |
| Provider abstraction change | The affected public provider/runtime package(s) |
| Test-only, documentation-only, or private debug change | Usually no changeset |
| `plugins/otis` change without a published package change | No package changeset; use the plugin manifest/deployment boundary |

Use the smallest compatible bump: `patch` for fixes, `minor` for
backward-compatible features, and `major` only after explicit approval for a
breaking change.

## Trusted publishing

The release workflow uses npm Trusted Publishing (OIDC); no long-lived npm
token is required. The configured repository is `SpiderByte/spiderbyte`, and
each package must have its npm trusted-publisher configuration set before
publication. This repository does not create accounts or configure vendor
access as part of a code change.

## Development workflow

From the repository root:

```sh
pnpm changeset
pnpm changeset status
```

Review the generated package names and bump levels before committing a
changeset. Release automation runs the normal clean-checkout, build, test,
package, license, SBOM, and policy gates before publication. No changeset is
evidence that the referenced capability is implemented; code and verification
remain authoritative.

## References

- [Product authority](../docs/architecture/SPIDERBYTE_PRODUCT_AUTHORITY.md)
- [Package rename and disposition map](../docs/release/PACKAGE_RENAME_MAP.md)
- [Changesets documentation](https://github.com/changesets/changesets)
