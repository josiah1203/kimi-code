#!/usr/bin/env bash
set -euo pipefail

# This smoke test exercises only the source checkout and local accountless
# surfaces. It deliberately supplies no provider, hosted, billing, or account
# credentials. It does not require a live model provider.
root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

smoke_home="$(mktemp -d "${TMPDIR:-/tmp}/spiderbyte-local-smoke.XXXXXX")"
trap 'rm -rf "$smoke_home"' EXIT

export SPIDERBYTE_HOME="$smoke_home/home"
export SPIDERBYTE_DISABLE_FS_WATCH=1
unset SPYDERBYTE_PROVIDER_CLI_CONFIG
unset OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_API_KEY OPENROUTER_API_KEY
unset SPIDERBYTE_API_KEY SPIDERBYTE_ACCESS_TOKEN SPIDERBYTE_ACCOUNT_TOKEN

run_cli() {
  pnpm --filter @spiderbyte/cli run dev:cli-only -- "$@"
}

run_cli --version
run_cli auth status --json
run_cli provider list --json
run_cli providers --json
run_cli capabilities --json
echo 'Local accountless smoke test passed.'
