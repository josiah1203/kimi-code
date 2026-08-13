#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

echo "== SpiderByte commercial seat licensing verification =="
echo "Checking the Open Core boundary..."
node scripts/check-open-core-boundary.mjs
echo "Checking workspace/Nix membership..."
node scripts/check-nix-workspace.mjs
echo "Typechecking licensing dependencies..."
pnpm --dir commercial/domain typecheck
pnpm --dir commercial/ports typecheck
pnpm --dir commercial/licensing typecheck
pnpm --dir commercial/adapters typecheck
pnpm --dir commercial/application typecheck
pnpm --dir commercial/persistence typecheck
pnpm --dir commercial/api typecheck
pnpm --dir commercial/sdk typecheck
echo "Running signed-license and lifecycle tests..."
pnpm --dir commercial/licensing test
pnpm --dir commercial/application test
pnpm --dir commercial/persistence test
pnpm --dir commercial/api test
git diff --check
echo "Commercial seat licensing verification passed."
