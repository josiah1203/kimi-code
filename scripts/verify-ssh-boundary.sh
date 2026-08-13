#!/usr/bin/env bash
set -euo pipefail

SPIDERBYTE_REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$SPIDERBYTE_REPO_ROOT"

echo "== SpiderByte SSH boundary verification =="
pnpm --config.engine-strict=false --filter @spiderbyte/agent-core exec vitest run \
  test/workspace/execution/sshDaemon.test.ts \
  test/workspace/execution/sshDaemonStdio.test.ts \
  test/workspace/execution/executionService.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism
pnpm --config.engine-strict=false --filter @spiderbyte/kaos exec vitest run \
  test/ssh.test.ts \
  test/ssh-create.test.ts \
  test/ssh-process.test.ts \
  test/e2e/ssh-mock.test.ts \
  test/e2e/ssh-resolve-path.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism
echo "SSH boundary verification passed."
