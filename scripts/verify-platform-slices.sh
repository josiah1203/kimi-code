#!/usr/bin/env bash
set -euo pipefail

# Node 24 is the repository's release engine. The current offline development
# image may expose Node 22, so keep pnpm's engine warning non-fatal here while
# still running the same package checks.
COREPACK_HOME="${COREPACK_HOME:-/tmp/kimi-corepack}"
export COREPACK_HOME

pnpm --config.engine-strict=false --filter @moonshot-ai/protocol typecheck
pnpm --config.engine-strict=false --filter @moonshot-ai/agent-core-v2 typecheck
pnpm --config.engine-strict=false --filter @moonshot-ai/klient typecheck
pnpm --config.engine-strict=false --filter @moonshot-ai/kimi-code-sdk typecheck
pnpm --config.engine-strict=false --filter @moonshot-ai/kap-server typecheck
pnpm --config.engine-strict=false --filter @moonshot-ai/vis-web typecheck

pnpm --config.engine-strict=false --filter @moonshot-ai/agent-core-v2 exec vitest run \
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

pnpm --config.engine-strict=false --filter @moonshot-ai/klient exec vitest run \
  test/browser.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism

git diff --check
