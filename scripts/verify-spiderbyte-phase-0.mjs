#!/usr/bin/env node
/**
 * Reproduce the Phase 0 authority/inventory/baseline evidence.
 *
 * This verifier does not call the full build or test suite. It proves that
 * the release documents, structured allowlists, package dispositions, and
 * historical audit counts can be checked from the current checkout.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const AUTHORITY_PATH = join(ROOT, 'config/spiderbyte-release-authority.json');
const authority = JSON.parse(readFileSync(AUTHORITY_PATH, 'utf8'));
const baselinePath = join(ROOT, authority.documents.baseline);
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

function runJson(script, args = []) {
  const result = spawnSync(process.execPath, [script, '--json', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    // The caller receives the command output in the failure message.
  }
  return { result, parsed };
}

function kindCounts(violations) {
  const counts = {};
  for (const violation of violations) {
    counts[violation.kind] = (counts[violation.kind] ?? 0) + 1;
  }
  return counts;
}

function main() {
  const failures = [];
  const inventoryRun = runJson('scripts/inventory-spiderbyte-release.mjs', ['--check']);
  if (inventoryRun.result.status !== 0 || !inventoryRun.parsed) {
    failures.push(`inventory command failed: ${inventoryRun.result.stderr || inventoryRun.result.stdout}`.trim());
  } else {
    for (const finding of inventoryRun.parsed.summary.failures) failures.push(`inventory: ${finding}`);
  }

  const boundaryRun = runJson('scripts/check-open-core-boundary.mjs');
  if (!boundaryRun.parsed) {
    failures.push(`Open Core boundary audit did not return JSON: ${boundaryRun.result.stderr || boundaryRun.result.stdout}`.trim());
  } else {
    kindCounts(boundaryRun.parsed.violations);
  }

  const brandingRun = runJson('scripts/check-branding.mjs');
  if (!brandingRun.parsed) {
    failures.push(`branding audit did not return JSON: ${brandingRun.result.stderr || brandingRun.result.stdout}`.trim());
  } else {
    if (!Array.isArray(brandingRun.parsed.findings)) {
      failures.push('branding audit returned a non-array findings value');
    }
  }

  const output = {
    ok: failures.length === 0,
    baseline: {
      path: authority.documents.baseline,
      commit: baseline.repository.commit,
      captured_at: baseline.captured_at,
    },
    checks: {
      inventory: inventoryRun.parsed?.summary ?? null,
      open_core_boundary_findings: boundaryRun.parsed?.violations.length ?? null,
      branding_findings: brandingRun.parsed?.findings.length ?? null,
    },
    historical_baseline: {
      inventory: baseline.inventory,
      audits: baseline.audits,
    },
    failures,
  };

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    console.log(`SpiderByte Phase 0 verification: ${output.ok ? 'PASS' : 'FAIL'}`);
    console.log(`Baseline commit: ${baseline.repository.commit}`);
    if (failures.length > 0) {
      for (const failure of failures) console.error(`  - ${failure}`);
    }
  }
  if (!output.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
