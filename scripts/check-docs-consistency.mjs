#!/usr/bin/env node
/**
 * Validate the documentation claims that define the current release surface.
 * This is intentionally a small, dependency-free gate: Markdown links are
 * checked by check-doc-links.mjs, while this script checks that the normative
 * status language and commands remain aligned with the implementation.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkDocs } from './check-doc-links.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

function read(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

function normalized(text) {
  return text.replace(/\s+/gu, ' ').trim().toLowerCase();
}

function checkDocumentationConsistency() {
  const failures = [];
  const authority = JSON.parse(read('config/spiderbyte-release-authority.json'));
  const openCore = JSON.parse(read('open-core.json'));
  const packageJson = JSON.parse(read('package.json'));

  for (const [name, path] of Object.entries(authority.documents ?? {})) {
    if (!existsSync(join(ROOT, path))) failures.push(`release authority document is missing: ${name} (${path})`);
  }

  const requiredDocs = {
    'README.md': [
      'SpiderByte Open Core',
      'No hosted SpiderByte credential is required',
      'seat-based',
      'browser UI source is maintained outside this checkout',
    ],
    'docs/architecture/SPIDERBYTE_PRODUCT_AUTHORITY.md': [
      'SpiderByte does not provide model access by default',
      'customers configure their own provider CLIs or APIs',
      'customers provide their own infrastructure',
      'hosted SpiderByte compute and model-usage billing are deferred optional products',
      'arbitrary shell execution is not exposed',
    ],
    'docs/release/SPIDERBYTE_SELF_HOSTED_OPERATIONS.md': [
      'Clean local installation',
      'Provider setup',
      'Docker deployment',
      'Kubernetes deployment',
      'GPU configuration',
      'Private network and tunnel setup',
      'ChatGPT and Codex plugin setup',
      'License activation, seats, and entitlements',
      'Security and data flow',
      'Upgrade, rollback, backup, and restore',
      'unsupported',
      'adapter-dependent',
      'SpiderByte does not provide model access by default',
      'customers configure their own provider CLIs or APIs',
      'customers provide their own infrastructure',
      'hosted SpiderByte compute is not required',
      'commercial plans are seat-based',
      'plugin access operates through the customer’s SpiderByte daemon',
      'arbitrary SSH is not exposed by default',
    ],
    'docs/release/SPIDERBYTE_OPEN_CORE_RELEASE_CHECKLIST.md': [
      'Open Core release contract',
      'Required clean-checkout gates',
      'Release evidence record',
      'Known blockers',
      'pnpm install --frozen-lockfile',
      'pnpm run build',
    ],
  };

  for (const [path, needles] of Object.entries(requiredDocs)) {
    if (!existsSync(join(ROOT, path))) {
      failures.push(`required documentation is missing: ${path}`);
      continue;
    }
    const text = normalized(read(path));
    for (const needle of needles) if (!text.includes(normalized(needle))) failures.push(`${path}: missing required claim or heading: ${needle}`);
  }

  for (const script of ['bootstrap:clean-checkout', 'smoke:local', 'check:package-consistency', 'check:docs-consistency']) {
    if (typeof packageJson.scripts?.[script] !== 'string') failures.push(`package.json is missing script ${script}`);
  }

  const surfaces = openCore.release_surfaces;
  for (const key of ['open_core', 'self_hosted_commercial', 'optional_future_hosted', 'plugin_integration', 'private_integrations', 'unavailable']) {
    if (surfaces?.[key] === undefined) failures.push(`open-core.json is missing release_surfaces.${key}`);
  }

  const links = checkDocs();
  for (const finding of links.findings) failures.push(`documentation link: ${finding}`);

  return { ok: failures.length === 0, failures, checked_documents: Object.keys(requiredDocs) };
}

function main() {
  const result = checkDocumentationConsistency();
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (result.ok) console.log(`SpiderByte documentation consistency passed for ${String(result.checked_documents.length)} authority documents.`);
  else {
    console.error(`SpiderByte documentation consistency found ${String(result.failures.length)} failure(s):`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
  }
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { checkDocumentationConsistency };
