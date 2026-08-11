#!/usr/bin/env node
/** Enforce zero lint errors and the owned, non-increasing warning budget. */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const policy = JSON.parse(readFileSync(join(ROOT, 'config/lint-warning-policy.json'), 'utf8'));
const result = spawnSync(join(ROOT, 'node_modules/.bin/oxlint'), ['--type-aware', '--format', 'json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
const report = JSON.parse(result.stdout);
const errors = report.diagnostics.filter((item) => item.severity === 'error').length;
const warnings = report.diagnostics.filter((item) => item.severity === 'warning').length;
const failures = [];
for (const field of ['owner', 'review_by', 'disposition']) if (typeof policy[field] !== 'string' || policy[field].length === 0) failures.push(`lint policy is missing ${field}`);
if (policy.schema_version !== 1) failures.push('lint policy schema_version must be 1');
if (new Date(`${policy.review_by}T23:59:59Z`) < new Date()) failures.push(`lint warning policy expired on ${policy.review_by}`);
if (errors > 0) failures.push(`lint reported ${String(errors)} error(s)`);
if (warnings > policy.maximum_warning_count) failures.push(`lint warning count increased from ${String(policy.maximum_warning_count)} to ${String(warnings)}`);
if (failures.length > 0) {
  console.error(`Lint policy found ${String(failures.length)} issue(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else console.log(`Lint policy passed with 0 errors and ${String(warnings)}/${String(policy.maximum_warning_count)} owned warnings.`);
