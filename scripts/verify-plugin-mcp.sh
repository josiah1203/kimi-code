#!/usr/bin/env bash
set -euo pipefail

SPIDERBYTE_REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$SPIDERBYTE_REPO_ROOT"

echo "== SpiderByte curated plugin/MCP verification =="
node scripts/check-otis-plugin.mjs
pnpm --config.engine-strict=false --filter @spiderbyte/kap-server exec vitest run \
  test/mcp.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism
pnpm --config.engine-strict=false --filter @spiderbyte/agent-core exec vitest run \
  test/agent/mcp/mcp.test.ts \
  test/agent/mcp/output.test.ts \
  test/app/mcpConfig/oauthStore.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism
echo "Curated plugin/MCP verification passed."
