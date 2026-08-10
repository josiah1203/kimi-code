#!/usr/bin/env node
/**
 * Release gate for the Open Core boundary.
 *
 * This intentionally reports known legacy authorities instead of hiding them:
 * a green platform-slice test is not evidence that hosted or commercial code
 * has been removed from the local product. The gate becomes release-clean only
 * after the listed migration paths are moved behind explicit adapters.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const MANIFEST_PATH = join(ROOT, 'open-core.json');

const COMMERCIAL_TOKENS = [
  'IWorkspaceCommercialService',
  'commercialService',
  'commercialContract',
  'GlobalCommercialFacade',
  'workspace/commercial',
];
const V1_PACKAGE = '@moonshot-ai/agent-core';
const V1_IMPORT_RE = /@moonshot-ai\/agent-core(?:['"/])/;
const HOSTED_PACKAGE_WORDS = ['commercial', 'enterprise', 'billing', 'hosted'];
const IMPORT_RE = /(?:from\s*|import\s*\(|require\s*\()(['"])([^'"]+)\1/g;
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

function walk(root) {
  if (!existsSync(root)) return [];
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const abs = join(root, entry.name);
    if (entry.isDirectory()) result.push(...walk(abs));
    else if (SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) result.push(abs);
  }
  return result;
}

function rel(abs) {
  return relative(ROOT, abs).split('\\').join('/');
}

function sourceRoots(manifest) {
  return manifest.open_core.packages
    .map((pkg) => join(ROOT, pkg, 'src'))
    .filter((path) => existsSync(path));
}

/** @returns {Array<{kind: string, path: string, detail: string}>} */
export function checkOpenCoreBoundary(manifest = loadManifest()) {
  const violations = [];
  const roots = sourceRoots(manifest);
  const legacyPaths = new Set(manifest.commercial.implementation_paths);
  const compatibilityPaths = manifest.open_core.legacy_compatibility_paths ?? [];

  for (const root of roots) {
    for (const file of walk(root)) {
      const path = rel(file);
      const text = readFileSync(file, 'utf8');
      const isQuarantinedLegacy = [...legacyPaths].some((legacyPath) => path.startsWith(legacyPath));
      if (isQuarantinedLegacy) continue;

      for (const token of COMMERCIAL_TOKENS) {
        if (text.includes(token)) {
          violations.push({
            kind: 'commercial-import-or-contract',
            path,
            detail: `contains ${token}`,
          });
        }
      }

      for (const match of text.matchAll(IMPORT_RE)) {
        const specifier = match[2];
        const packageName = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0];
        if (manifest.commercial.package_prefixes.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`))) {
          violations.push({ kind: 'commercial-package-import', path, detail: specifier });
        }
        if (HOSTED_PACKAGE_WORDS.some((word) => packageName.toLowerCase().includes(word))) {
          violations.push({ kind: 'hosted-package-import', path, detail: specifier });
        }
      }

      const isCanonicalAdapterConstruction =
        path === 'packages/agent-core-v2/src/kosong/model/modelRequesterImpl.ts' ||
        path === 'packages/agent-core-v2/src/kosong/protocol/protocolAdapterRegistry.ts' ||
        path.startsWith('packages/agent-core-v2/src/kosong/provider/bases/');
      if (path.startsWith('packages/agent-core-v2/src/kosong/') && text.includes('createChatProvider(') && !isCanonicalAdapterConstruction && !path.endsWith('/protocol.ts') && !path.endsWith('/protocolBase.ts') && !path.endsWith('/protocolAdapterRegistry.ts')) {
        // The provider registry is the only allowed construction seam. A
        // direct adapter construction here would bypass ProviderConnection.
        violations.push({ kind: 'provider-adapter-bypass', path, detail: 'direct createChatProvider call in kosong' });
      }
      const isCompatibilityPath = compatibilityPaths.some((compatibilityPath) => path.startsWith(compatibilityPath));
      if (!isQuarantinedLegacy && !isCompatibilityPath && V1_IMPORT_RE.test(text)) {
        violations.push({ kind: 'legacy-core-import', path, detail: `imports ${V1_PACKAGE}` });
      }
    }
  }

  for (const pkgPath of manifest.open_core.packages) {
    const packageJsonPath = join(ROOT, pkgPath, 'package.json');
    if (!existsSync(packageJsonPath)) {
      violations.push({ kind: 'missing-open-core-package', path: pkgPath, detail: 'package.json not found' });
      continue;
    }
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const name of Object.keys(pkg[section] ?? {})) {
        if (manifest.commercial.package_prefixes.some((prefix) => name === prefix || name.startsWith(`${prefix}/`))) {
          violations.push({ kind: 'commercial-package-dependency', path: pkgPath, detail: `${section}: ${name}` });
        }
      }
    }
  }

  for (const legacyPath of manifest.commercial.implementation_paths) {
    if (existsSync(join(ROOT, legacyPath))) {
      violations.push({ kind: 'commercial-implementation-in-open-core-package', path: legacyPath, detail: 'move behind a separate package before release' });
    }
  }
  for (const publicPath of manifest.commercial.public_contract_paths) {
    if (existsSync(join(ROOT, publicPath))) {
      const text = readFileSync(join(ROOT, publicPath), 'utf8');
      if (COMMERCIAL_TOKENS.some((token) => text.includes(token)) || text.includes('/commercial/')) {
        violations.push({ kind: 'commercial-public-contract', path: publicPath, detail: 'public Open Core surface exposes commercial implementation' });
      }
    }
  }

  const frontendSource = manifest.open_core.external_frontend_source;
  if (!existsSync(join(ROOT, frontendSource.path))) {
    violations.push({ kind: 'frontend-source-unavailable', path: frontendSource.path, detail: 'source lives in the external code-app repository; dist-web is not an editable source' });
  }
  if (existsSync(join(ROOT, frontendSource.generated_bundle))) {
    violations.push({ kind: 'generated-frontend-awaiting-sync', path: frontendSource.generated_bundle, detail: 'branding and route changes must be made in the source frontend repository' });
  }

  return violations;
}

function main() {
  const manifest = loadManifest();
  const violations = checkOpenCoreBoundary(manifest);
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ ok: violations.length === 0, violations }, null, 2)}\n`);
  } else if (violations.length === 0) {
    console.log('Open Core boundary check passed.');
  } else {
    console.error(`Open Core boundary check found ${String(violations.length)} blocker(s):`);
    for (const violation of violations) {
      console.error(`  [${violation.kind}] ${violation.path} — ${violation.detail}`);
    }
    console.error('\nCommercial and generated-frontend blockers must be migrated before an Open Core release.');
  }
  if (violations.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
