# @spiderbyte/cli

The canonical SpiderByte command-line and terminal UI package. It publishes
the `spyderbyte` executable and starts the local SpiderByte Agent Core
runtime; it has no hosted account or Business-service dependency.

```sh
pnpm --filter @spiderbyte/cli run build
node apps/cli/dist/main.mjs --version
```

From a project directory, run `spyderbyte` and configure a local or BYOK
provider with `spyderbyte configure`. The browser UI is an external client;
this package does not include an unreproducible generated web bundle.

See the repository [Open Core boundary](../../docs/architecture/OPEN_CORE_BOUNDARY.md)
and [package rename map](../../docs/release/PACKAGE_RENAME_MAP.md).
