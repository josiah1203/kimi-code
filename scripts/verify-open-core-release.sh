#!/usr/bin/env bash
set -uo pipefail

log_dir="${SPIDERBYTE_RELEASE_LOG_DIR:-.tmp/open-core-release-gates}"
mkdir -p "$log_dir"
failed=0

run_gate() {
  local name="$1"
  shift
  local log="$log_dir/$name.log"
  echo "==> $name"
  if "$@" >"$log" 2>&1; then
    cat "$log"
  else
    cat "$log"
    failed=1
  fi
}

run_gate node-version node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) throw new Error("SpiderByte releases require Node.js 24.15.0 or newer")'
run_gate phase-0 pnpm run verify:phase-0
run_gate typecheck pnpm run typecheck
run_gate lint pnpm run lint
run_gate lint-policy pnpm run check:lint-policy
run_gate sherif pnpm run sherif
run_gate test pnpm run test
run_gate build pnpm run build
run_gate package-dispositions pnpm run check:package-dispositions
run_gate package-consistency pnpm run check:package-consistency
run_gate open-core-boundary pnpm run check:open-core
run_gate branding pnpm run check:branding
run_gate package-names pnpm run check:package-names
run_gate legacy-runtime pnpm run check:legacy-runtime
run_gate generate-sbom pnpm run generate:sbom
run_gate validate-sbom pnpm run check:sbom
run_gate license-policy pnpm run check:licenses
run_gate generate-notices pnpm run generate:notices
run_gate generated-evidence pnpm run check:generated-evidence
run_gate secrets pnpm run check:secrets
run_gate release-policy pnpm run check:release-policy
run_gate dependency-audit pnpm audit --prod
run_gate accountless-local pnpm run verify:accountless-local
run_gate platform-slices bash scripts/verify-platform-slices.sh
run_gate provider-cli-adapters bash scripts/verify-provider-cli-adapters.sh
run_gate self-hosted-connections bash scripts/verify-self-hosted-connections.sh
run_gate ssh-boundary bash scripts/verify-ssh-boundary.sh
run_gate plugin-mcp bash scripts/verify-plugin-mcp.sh
run_gate commercial-seat-licensing bash scripts/verify-commercial-seat-licensing.sh
run_gate cross-workspace-authz bash scripts/verify-cross-workspace-authz.sh
run_gate package-artifacts pnpm run verify:package-artifacts
run_gate documentation-links pnpm run check:docs-links
run_gate documentation-consistency pnpm run check:docs-consistency
run_gate documentation pnpm --filter spiderbyte-docs run build
run_gate whitespace git diff --check

if (( failed != 0 )); then
  echo "One or more Open Core release gates failed. Logs: $log_dir" >&2
fi
exit "$failed"
