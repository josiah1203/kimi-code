#!/usr/bin/env node
/**
 * Release gate for the Open Core boundary.
 *
 * This intentionally reports known legacy authorities instead of hiding them:
 * a green platform-slice test is not evidence that hosted or commercial code
 * has been removed from the local product. The gate becomes release-clean only
 * after the listed migration paths are moved behind explicit adapters.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const MANIFEST_PATH = join(ROOT, 'open-core.json');
const AUTHORITY_PATH = join(ROOT, 'config/spiderbyte-release-authority.json');

const COMMERCIAL_TOKENS = [
  'IWorkspaceCommercialService',
  'commercialService',
  'commercialContract',
  'GlobalCommercialFacade',
  'workspace/commercial',
];
const V1_PACKAGE = '@spiderbyte/legacy-agent-core';
const V1_IMPORT_RE = /@spiderbyte\/legacy-agent-core(?:['"/])/;
const HOSTED_PACKAGE_WORDS = ['commercial', 'enterprise', 'billing', 'hosted'];
const IMPORT_RE = /(?:from\s*|import\s*\(|require\s*\()(['"])([^'"]+)\1/g;
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);

function isCommercialPackageName(name, prefix) {
  return name === prefix || name.startsWith(`${prefix}/`) || name.startsWith(`${prefix}-`);
}

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

function loadAuthority() {
  const authority = JSON.parse(readFileSync(AUTHORITY_PATH, 'utf8'));
  for (const [name, path] of Object.entries(authority.documents ?? {})) {
    const absolute = join(ROOT, path);
    if (!existsSync(absolute)) throw new Error(`missing release authority document ${name}: ${path}`);
    const text = readFileSync(absolute, 'utf8');
    for (const heading of authority.required_document_headings?.[name] ?? []) {
      if (!text.includes(heading)) throw new Error(`missing required heading in ${path}: ${heading}`);
    }
  }
  for (const [category, entries] of Object.entries(authority.allowlists ?? {})) {
    if (!Array.isArray(entries)) throw new Error(`release authority allowlist is not an array: ${category}`);
    for (const [index, entry] of entries.entries()) {
      for (const field of ['path', 'token', 'reason', 'owner', 'review_by']) {
        if (typeof entry[field] !== 'string' || entry[field].length === 0) {
          throw new Error(`release authority allowlist ${category}[${String(index)}] is missing ${field}`);
        }
      }
      if (!existsSync(join(ROOT, entry.path))) {
        throw new Error(`release authority allowlist ${category}[${String(index)}] path does not exist: ${entry.path}`);
      }
    }
  }
  return authority;
}

function assertManifestAuthority(manifest, authority) {
  const expected = {
    migration_plan: authority.documents.migration_plan,
    package_rename_map: authority.documents.package_rename_map,
    open_core_boundary: authority.documents.open_core_boundary,
    product_authority: authority.documents.product_authority,
    machine_readable_authority: 'config/spiderbyte-release-authority.json',
    baseline: authority.documents.baseline,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (manifest.release_authority?.[field] !== value) {
      throw new Error(`open-core.json release_authority.${field} must reference ${value}`);
    }
  }
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
  const authority = loadAuthority();
  assertManifestAuthority(manifest, authority);
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
        if (manifest.commercial.package_prefixes.some((prefix) => isCommercialPackageName(specifier, prefix))) {
          violations.push({ kind: 'commercial-package-import', path, detail: specifier });
        }
        if (HOSTED_PACKAGE_WORDS.some((word) => packageName.toLowerCase().includes(word))) {
          violations.push({ kind: 'hosted-package-import', path, detail: specifier });
        }
      }

      const isCanonicalAdapterConstruction =
        path === 'packages/agent-core/src/kosong/model/modelRequesterImpl.ts' ||
        path === 'packages/agent-core/src/kosong/protocol/protocolAdapterRegistry.ts' ||
        path.startsWith('packages/agent-core/src/kosong/provider/bases/');
      if (path.startsWith('packages/agent-core/src/kosong/') && text.includes('createChatProvider(') && !isCanonicalAdapterConstruction && !path.endsWith('/protocol.ts') && !path.endsWith('/protocolBase.ts') && !path.endsWith('/protocolAdapterRegistry.ts')) {
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
        if (manifest.commercial.package_prefixes.some((prefix) => isCommercialPackageName(name, prefix))) {
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
  for (const excludedPath of manifest.commercial.excluded_implementation_paths ?? []) {
    const absolute = join(ROOT, excludedPath);
    if (!existsSync(absolute)) {
      violations.push({ kind: 'missing-excluded-commercial-implementation', path: excludedPath, detail: 'excluded implementation must be present in its separate distribution location or removed' });
      continue;
    }
    if (manifest.open_core.packages.some((pkg) => excludedPath === pkg || excludedPath.startsWith(`${pkg}/`))) {
      violations.push({ kind: 'excluded-commercial-implementation-in-open-core-package', path: excludedPath, detail: 'excluded implementation is still under an Open Core package' });
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
  if (frontendSource.required_for_open_core !== false && !existsSync(join(ROOT, frontendSource.path))) {
    violations.push({ kind: 'frontend-source-unavailable', path: frontendSource.path, detail: 'source lives in the external code-app repository; dist-web is not an editable source' });
  }
  if (typeof frontendSource.generated_bundle === 'string' && existsSync(join(ROOT, frontendSource.generated_bundle))) {
    violations.push({ kind: 'generated-frontend-awaiting-sync', path: frontendSource.generated_bundle, detail: 'branding and route changes must be made in the source frontend repository' });
  }

  return violations;
}

function main() {
  const manifest = loadManifest();
  const authority = loadAuthority();
  const violations = checkOpenCoreBoundary(manifest);
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({
      ok: violations.length === 0,
      violations,
      authority: {
        documents: authority.documents,
        allowlist_categories: Object.fromEntries(
          Object.entries(authority.allowlists ?? {}).map(([category, entries]) => [category, entries.length]),
        ),
      },
    }, null, 2)}\n`);
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
