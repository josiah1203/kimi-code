#!/usr/bin/env bash
set -euo pipefail

# This suite is deliberately local-only. It does not set provider credentials,
# account credentials, hosted URLs, or commercial feature flags.
COREPACK_HOME="${COREPACK_HOME:-/tmp/kimi-corepack}"
export COREPACK_HOME

gate_failed=0
if ! node scripts/check-open-core-boundary.mjs; then gate_failed=1; fi
if ! node scripts/check-branding.mjs; then gate_failed=1; fi
if ! bash scripts/verify-platform-slices.sh; then gate_failed=1; fi

if ! pnpm --config.engine-strict=false --filter @moonshot-ai/agent-core-v2 exec vitest run \
  test/app/auth/auth.test.ts \
  test/lint/import-boundaries.test.ts \
  test/workspace/providerConnections/providerRuntimeService.test.ts \
  test/workspace/ml/mlService.test.ts \
  test/session/run/run.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism; then gate_failed=1; fi

git diff --check
exit "$gate_failed"
