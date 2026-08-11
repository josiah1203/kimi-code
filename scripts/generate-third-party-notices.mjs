#!/usr/bin/env node
/** Generate deterministic dependency attribution from the resolved SBOM. */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const bom = JSON.parse(readFileSync(join(ROOT, 'sbom.cdx.json'), 'utf8'));
const dependencies = bom.components.filter((component) => !component['bom-ref'].startsWith('workspace:'));
const lines = [
  '# Third-Party Notices',
  '',
  'SpiderByte includes or depends on the packages below. License expressions are generated from the lockfile-resolved CycloneDX SBOM and reviewed override registry. Consult each upstream package for the complete license text.',
  '',
  '| Package | Version | License |',
  '| --- | --- | --- |',
  ...dependencies.map((component) => `| ${component.name.replaceAll('|', '\\|')} | ${component.version.replaceAll('|', '\\|')} | ${component.licenses.map((item) => item.expression).join(' OR ').replaceAll('|', '\\|')} |`),
  '',
];
writeFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), `${lines.join('\n')}\n`);
console.log(`Wrote THIRD_PARTY_NOTICES.md with ${String(dependencies.length)} dependency entries.`);
