#!/usr/bin/env node
/**
 * Generate the repository's source/workspace SBOM inventory.
 *
 * This is intentionally a manifest-level inventory, not a substitute for a
 * release-time lockfile/license scanner. The output records that limitation
 * in CycloneDX properties so it cannot be mistaken for a complete legal bill
 * of materials.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const OUTPUT = join(ROOT, 'sbom.cdx.json');

function workspacePackageDirs() {
  const dirs = ['.'];
  for (const parent of ['packages', 'apps']) {
    const root = join(ROOT, parent);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      dirs.push(join(parent, entry.name));
    }
  }
  for (const path of ['docs']) {
    if (!dirs.includes(path) && existsSync(join(ROOT, path))) dirs.push(path);
  }
  return dirs.filter((path) => existsSync(join(ROOT, path, 'package.json')));
}

function packageJson(path) {
  return JSON.parse(readFileSync(join(ROOT, path, 'package.json'), 'utf8'));
}

function component(name, version, properties = []) {
  return {
    type: 'library',
    name,
    version,
    properties,
  };
}

function main() {
  const components = [];
  const seen = new Set();
  for (const path of workspacePackageDirs()) {
    const pkg = packageJson(path);
    const key = `${pkg.name}@${pkg.version}`;
    if (!seen.has(key)) {
      seen.add(key);
      components.push(component(pkg.name, pkg.version, [
        { name: 'org.spyderbyte.source.path', value: path },
        { name: 'org.spyderbyte.license.declared', value: pkg.license ?? 'UNKNOWN' },
      ]));
    }
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, version] of Object.entries(pkg[section] ?? {})) {
        const depKey = `${name}@${String(version)}`;
        if (seen.has(depKey)) continue;
        seen.add(depKey);
        components.push(component(name, String(version), [
          { name: 'org.spyderbyte.source.package', value: pkg.name },
          { name: 'org.spyderbyte.source.section', value: section },
          { name: 'org.spyderbyte.license.status', value: 'resolve-from-lockfile-and-upstream-before-release' },
        ]));
      }
    }
  }
  components.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: 'urn:uuid:00000000-0000-4000-8000-000000000001',
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: 'SpiderByte', name: 'generate-sbom.mjs', version: '1' }],
      properties: [
        { name: 'org.spyderbyte.completeness', value: 'workspace-manifest-inventory' },
        { name: 'org.spyderbyte.release-gate', value: 'requires-lockfile-license-resolution-and-source-ownership-review' },
      ],
    },
    components,
  };
  writeFileSync(OUTPUT, `${JSON.stringify(bom, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT} with ${String(components.length)} components.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
