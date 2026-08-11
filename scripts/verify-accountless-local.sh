#!/usr/bin/env bash
set -euo pipefail

# Deterministic local-product smoke suite. Hosted identity, billing, managed
# provider, and external-provider credentials are deliberately removed.
unset OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_API_KEY OPENROUTER_API_KEY
unset SPIDERBYTE_API_KEY SPIDERBYTE_ACCESS_TOKEN SPIDERBYTE_ACCOUNT_TOKEN

pnpm --config.engine-strict=false --filter @spiderbyte/agent-core exec vitest run \
  test/workspace/platformServices.test.ts \
  test/workspace/budgets/budgetService.test.ts \
  test/workspace/providerConnections/providerRuntimeService.test.ts \
  test/session/run/run.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism

pnpm --config.engine-strict=false --filter @spiderbyte/kap-server exec vitest run \
  test/v2Platform.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism
