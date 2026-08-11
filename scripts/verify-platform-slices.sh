#!/usr/bin/env bash
set -euo pipefail

# Node 24 is the repository's release engine. The current offline development
# image may expose Node 22, so keep pnpm's engine warning non-fatal here while
# still running the same package checks.
COREPACK_HOME="${COREPACK_HOME:-/tmp/kimi-corepack}"
export COREPACK_HOME

pnpm --config.engine-strict=false --filter @spiderbyte/protocol typecheck
pnpm --config.engine-strict=false --filter @spiderbyte/agent-core typecheck
pnpm --config.engine-strict=false --filter @spiderbyte/client typecheck
pnpm --config.engine-strict=false --filter @spiderbyte/sdk typecheck
pnpm --config.engine-strict=false --filter @spiderbyte/kap-server typecheck

pnpm --config.engine-strict=false --filter @spiderbyte/agent-core exec vitest run \
  test/workspace/platformServices.test.ts \
  test/workspace/providerConnections/providerConnectionService.test.ts \
  test/workspace/providerConnections/providerRuntimeService.test.ts \
  test/workspace/policy/policyService.test.ts \
  test/workspace/ml/mlService.test.ts \
  test/workspace/pipelines/pipelineService.test.ts \
  test/workspace/execution/executionService.test.ts \
  test/workspace/execution/platformWorker.test.ts \
  test/workspace/serving/servingService.test.ts \
  test/session/run/run.test.ts \
  test/agent/llmRequester/llmRequesterService.test.ts \
  test/agent/platformModelBinding/platformModelBindingService.test.ts \
  test/agent/platformRunReplay/platformRunReplayService.test.ts \
  test/agent/tools/platform/platformTools.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism

pnpm --config.engine-strict=false --filter @spiderbyte/client exec vitest run \
  test/browser.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism

git diff --check
