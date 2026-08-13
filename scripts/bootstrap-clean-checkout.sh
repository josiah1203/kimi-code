#!/usr/bin/env bash
set -euo pipefail

# Rehearse the first steps a user or release worker performs from a clean
# checkout. This script never deletes files or creates a hosted account.
root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

node - <<'NODE'
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && minor < 15)) {
  console.error(`SpiderByte requires Node.js 24.15.0 or newer; found ${process.version}.`);
  process.exit(1);
}
NODE

if ! command -v pnpm >/dev/null 2>&1; then
  echo 'pnpm 10.33.0 is required but was not found.' >&2
  exit 1
fi

pnpm_version="$(pnpm --version)"
if [[ "$pnpm_version" != "10.33.0" ]]; then
  echo "SpiderByte requires pnpm 10.33.0; found $pnpm_version." >&2
  exit 1
fi

pnpm install --frozen-lockfile
pnpm run check:package-consistency
pnpm run check:docs-consistency
echo 'Clean-checkout bootstrap completed. Run `pnpm run smoke:local` for the accountless local smoke test.'
