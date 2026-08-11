#!/usr/bin/env node
/** Ensure deterministic release evidence is tracked and matches the repository state. */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const GENERATED_FILES = ['sbom.cdx.json', 'THIRD_PARTY_NOTICES.md'];

function git(args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

function main() {
  const failures = [];
  for (const file of GENERATED_FILES) {
    if (git(['ls-files', '--error-unmatch', '--', file]).status !== 0) {
      failures.push(`${file} is not tracked`);
      continue;
    }
    if (git(['diff', '--quiet', '--', file]).status !== 0) failures.push(`${file} differs from the index`);
    if (git(['diff', '--cached', '--quiet', '--', file]).status !== 0) failures.push(`${file} differs from HEAD in the index`);
  }

  if (failures.length > 0) {
    process.stderr.write(`Generated release evidence is not committed cleanly (${String(failures.length)} issue(s)):\n`);
    for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Generated release evidence is tracked and clean: ${GENERATED_FILES.join(', ')}\n`);
  }
}

main();
