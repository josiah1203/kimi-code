# Migrating to SpiderByte Open Core

SpiderByte Open Core is a local Node.js distribution with the `spyderbyte` executable and the unversioned SpiderByte Agent Core runtime. Its supported configuration and data directory is `.spiderbyte`.

## Start with a new local profile

Create a separate data root while evaluating the migration:

```sh
SPIDERBYTE_HOME="$PWD/.spiderbyte-migration" spyderbyte doctor
```

Copy only the provider, model, permission, and loop settings you understand into the new `config.toml`. Replace any hosted account fields with an explicit local endpoint or a BYOK provider record. Use `YOUR_API_KEY` in templates and set real credentials only in an ignored local file or the process environment.

## Sessions and artifacts

Session export/import is a versioned local protocol. Export a session from the source installation, inspect the archive, and import it only when the target reports that its schema version is supported. Do not copy live credential files, token stores, logs, or plugin caches between installations.

```sh
spyderbyte export <session-id> -o ./session-export.zip
```

If an older archive cannot be read, retain it as an external record and start a new local session. The Open Core runtime must not silently route an unsupported archive through a legacy engine.

## Compatibility material

Temporary compatibility code is quarantined below `compat/` and is excluded from the workspace build and published package graph. It is not a supported runtime dependency. The compatibility inventory and planned removal decisions are recorded in [`PACKAGE_RENAME_MAP.md`](../release/PACKAGE_RENAME_MAP.md).

## What is not part of this migration

The Open Core checkout does not migrate hosted identity, subscriptions, billing, managed workers, hosted approvals, or managed provider quota. Those capabilities are commercial and require a separately maintained distribution if they are offered in the future.
