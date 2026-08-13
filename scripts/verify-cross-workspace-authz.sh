#!/usr/bin/env bash
set -euo pipefail

SPIDERBYTE_REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$SPIDERBYTE_REPO_ROOT"

echo "== SpiderByte cross-workspace authorization verification =="
pnpm --config.engine-strict=false --filter @spiderbyte/agent-core exec vitest run \
  test/app/authorization/authorizationService.test.ts \
  test/app/secrets/platformSecretStore.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism
pnpm --config.engine-strict=false --filter @spiderbyte/kap-server exec vitest run \
  test/authMiddleware.test.ts \
  test/authTokenStore.test.ts \
  test/authWiring.e2e.test.ts \
  test/platformAuthorization.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism
echo "Cross-workspace authorization verification passed."
