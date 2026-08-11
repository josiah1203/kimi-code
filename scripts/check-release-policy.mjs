#!/usr/bin/env node
/** Validate ownership, legal files, attribution, and release provenance configuration. */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const REQUIRED_FILES = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'CONTRIBUTING.md', '.github/CODEOWNERS'];

function main() {
  const failures = [];
  for (const path of REQUIRED_FILES) if (!existsSync(join(ROOT, path))) failures.push(`missing required release file: ${path}`);
  const codeowners = readFileSync(join(ROOT, '.github/CODEOWNERS'), 'utf8');
  if (!/^\*\s+@\S+/m.test(codeowners)) failures.push('CODEOWNERS must define a default owner');

  const bom = JSON.parse(readFileSync(join(ROOT, 'sbom.cdx.json'), 'utf8'));
  const notices = readFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  for (const component of bom.components.filter((item) => !item['bom-ref'].startsWith('workspace:'))) {
    const rowStart = `| ${component.name.replaceAll('|', '\\|')} | ${component.version.replaceAll('|', '\\|')} |`;
    if (!notices.includes(rowStart)) failures.push(`${component['bom-ref']}: missing third-party notice`);
  }

  const inventory = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'scripts/inventory-spiderbyte-release.mjs'), '--json', '--check'], { cwd: ROOT }));
  for (const pkg of inventory.packages.filter((item) => item.target?.publish === true)) {
    const manifest = JSON.parse(readFileSync(join(ROOT, pkg.path, 'package.json'), 'utf8'));
    if (manifest.publishConfig?.provenance !== true) failures.push(`${pkg.name}: publishConfig.provenance must be true`);
  }
  const releaseWorkflow = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
  if (!/^\s+id-token: write/m.test(releaseWorkflow)) failures.push('release workflow must grant OIDC id-token: write');
  if (!releaseWorkflow.includes('changeset publish')) failures.push('release workflow must publish through the reviewed changesets command');
  const nativeWorkflow = readFileSync(join(ROOT, '.github/workflows/_native-build.yml'), 'utf8');
  if (!nativeWorkflow.includes('.zip.sha256')) failures.push('native release workflow must upload SHA-256 checksums');
  if (!nativeWorkflow.includes('verify-artifact.mjs')) failures.push('native release workflow must verify SHA-256 checksums');
  if (!nativeWorkflow.includes('attestations: write')) failures.push('native release workflow must grant artifact attestation permission');
  if (!nativeWorkflow.includes('actions/attest-build-provenance@v2')) failures.push('native release workflow must attest build provenance');
  const nativeVerifier = readFileSync(join(ROOT, 'apps/cli/scripts/native/05-verify.mjs'), 'utf8');
  for (const verifier of ['codesign', 'spctl']) if (!nativeVerifier.includes(verifier)) failures.push(`native release verifier must run ${verifier}`);
  if (!releaseWorkflow.includes('verify-artifact.mjs') || !releaseWorkflow.includes('gh attestation verify')) failures.push('native release publication must verify artifact checksums and attestations');

  if (failures.length > 0) {
    console.error(`Release policy check found ${String(failures.length)} issue(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else console.log(`Release ownership, attribution, and provenance policy passed for ${String(inventory.packages.filter((item) => item.target?.publish === true).length)} publish targets.`);
}

main();
