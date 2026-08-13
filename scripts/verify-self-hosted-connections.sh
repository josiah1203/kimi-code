#!/usr/bin/env bash
set -euo pipefail

SPIDERBYTE_REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$SPIDERBYTE_REPO_ROOT"

echo "== SpiderByte self-hosted connection verification =="
pnpm --config.engine-strict=false --filter @spiderbyte/agent-core exec vitest run \
  test/workspace/platformServices.test.ts \
  test/workspace/execution/executionService.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism
pnpm --config.engine-strict=false --filter @spiderbyte/kap-server exec vitest run \
  test/connections.test.ts \
  test/v2Platform.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism
echo "Self-hosted connection verification passed."
