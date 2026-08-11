# Deprecated legacy SDK compatibility source

This directory contains the retired v1 SDK implementation and its historical
tests. It is intentionally outside `pnpm-workspace.yaml`, the default build,
the published package graph, and the Open Core boundary.

New integrations must use `@spiderbyte/sdk`, which is backed by the canonical
SpiderByte Agent Core runtime. This compatibility source has no support or
release commitment and is scheduled for removal after downstream migration.
