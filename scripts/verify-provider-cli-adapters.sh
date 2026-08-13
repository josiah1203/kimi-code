#!/usr/bin/env bash
set -euo pipefail

SPIDERBYTE_REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$SPIDERBYTE_REPO_ROOT"

echo "== SpiderByte provider CLI adapter verification =="
pnpm --config.engine-strict=false --filter @spiderbyte/kaos exec vitest run \
  test/provider-command.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism
pnpm --config.engine-strict=false --filter @spiderbyte/agent-core exec vitest run \
  test/workspace/providerConnections/providerRuntimeService.test.ts \
  test/agent/platformModelBinding/platformModelBindingService.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism
pnpm --config.engine-strict=false --filter @spiderbyte/cli exec vitest run \
  test/cli/provider.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism
echo "Provider CLI adapter verification passed."
