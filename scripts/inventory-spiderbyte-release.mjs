#!/usr/bin/env node
/**
 * Inventory the release topology used by the SpiderByte Open Core gates.
 *
 * This command intentionally reads PACKAGE_RENAME_MAP.md instead of keeping a
 * second package list in code. The markdown map is the human-reviewable
 * authority; the machine-readable release-authority file records where that
 * authority lives and validates its required sections.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const AUTHORITY_PATH = join(ROOT, 'config/spiderbyte-release-authority.json');
const WORKSPACE_PATH = join(ROOT, 'pnpm-workspace.yaml');
const PACKAGE_MAP_PATH = join(ROOT, 'docs/release/PACKAGE_RENAME_MAP.md');
const OPEN_CORE_PATH = join(ROOT, 'open-core.json');

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.tmp',
  'node_modules',
  'coverage',
  'dist',
  'dist-native',
  'dist-web',
  '.next',
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function rel(path) {
  return relative(ROOT, path).split('\\').join('/') || '.';
}

function markdownValue(value) {
  return value.trim().replaceAll('`', '');
}

function parseWorkspacePatterns() {
  const patterns = [];
  let inPackages = false;
  for (const line of readFileSync(WORKSPACE_PATH, 'utf8').split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(line)) break;
    if (!inPackages) continue;
    const match = line.match(/^\s*-\s+(.+?)\s*$/);
    if (match) patterns.push(match[1]);
  }
  return patterns;
}

function globMatches(pattern, path) {
  const source = pattern
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replaceAll('*', '[^/]+');
  return new RegExp(`^${source}$`).test(path);
}

function isWorkspacePath(path, patterns) {
  return patterns.some((pattern) => globMatches(pattern, path));
}

function packageManifestPaths(root = ROOT) {
  const result = [];
  const visit = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) visit(absolute);
        continue;
      }
      if (entry.isFile() && entry.name === 'package.json') result.push(absolute);
    }
  };
  visit(root);
  return result.sort((a, b) => a.localeCompare(b));
}

function parseRenameMap() {
  const rows = [];
  for (const line of readFileSync(PACKAGE_MAP_PATH, 'utf8').split('\n')) {
    if (!line.startsWith('|') || /^\|\s*:?-{3,}/.test(line)) continue;
    const columns = line
      .split('|')
      .slice(1, -1)
      .map(markdownValue);
    if (columns[0] === 'Current path' || columns.length < 6) continue;
    rows.push({
      current_path: columns[0],
      current_package: columns[1],
      target_path: columns[2],
      target_package: columns[3],
      publish_target: columns[4] === 'Yes',
      disposition: columns[5],
    });
  }
  return rows;
}

function validateAuthorityDocuments(authority) {
  const failures = [];
  for (const [name, path] of Object.entries(authority.documents ?? {})) {
    const absolute = join(ROOT, path);
    if (!existsSync(absolute)) {
      failures.push(`missing authority document: ${name} (${path})`);
      continue;
    }
    const text = readFileSync(absolute, 'utf8');
    for (const heading of authority.required_document_headings?.[name] ?? []) {
      if (!text.includes(heading)) {
        failures.push(`missing required heading in ${path}: ${heading}`);
      }
    }
  }
  return failures;
}

function validateAllowlist(authority) {
  const failures = [];
  for (const [category, entries] of Object.entries(authority.allowlists ?? {})) {
    if (!Array.isArray(entries)) {
      failures.push(`allowlist is not an array: ${category}`);
      continue;
    }
    for (const [index, entry] of entries.entries()) {
      for (const field of ['path', 'token', 'reason', 'owner', 'review_by']) {
        if (typeof entry[field] !== 'string' || entry[field].length === 0) {
          failures.push(`allowlist ${category}[${String(index)}] missing ${field}`);
        }
      }
      if (entry.path && !existsSync(join(ROOT, entry.path))) {
        failures.push(`allowlist ${category}[${String(index)}] path does not exist: ${entry.path}`);
      }
      if (entry.review_by && !/^\d{4}-\d{2}-\d{2}$/.test(entry.review_by)) {
        failures.push(`allowlist ${category}[${String(index)}] has invalid review_by: ${entry.review_by}`);
      }
    }
  }
  return failures;
}

function validateManifestAuthority(manifest, authority) {
  const failures = [];
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
      failures.push(`open-core.json release_authority.${field} must reference ${value}`);
    }
  }
  return failures;
}

function validateTrackedSurfaces(authority, manifest) {
  const failures = [];
  const mapText = readFileSync(PACKAGE_MAP_PATH, 'utf8');
  const entries = authority.tracked_legacy_and_public_surfaces ?? [];
  const tracked = new Set();
  for (const [index, entry] of entries.entries()) {
    for (const field of ['path_or_surface', 'kind', 'target', 'disposition', 'owner', 'review_by']) {
      if (typeof entry[field] !== 'string' || entry[field].length === 0) {
        failures.push(`tracked surface ${String(index)} is missing ${field}`);
      }
    }
    if (entry.path_or_surface) {
      tracked.add(entry.path_or_surface);
      if (!mapText.includes(entry.path_or_surface)) {
        failures.push(`tracked surface is missing from PACKAGE_RENAME_MAP.md: ${entry.path_or_surface}`);
      }
    }
  }

  const requiredSurfaces = [
    ...(manifest.open_core?.legacy_compatibility_paths ?? []),
    ...(manifest.commercial?.implementation_paths ?? []),
    ...(manifest.commercial?.public_contract_paths ?? []),
    manifest.open_core?.external_frontend_source?.path,
    manifest.open_core?.external_frontend_source?.generated_bundle,
  ].filter(Boolean);
  for (const surface of requiredSurfaces) {
    if (!tracked.has(surface)) failures.push(`repository manifest surface has no Phase 0 disposition: ${surface}`);
  }
  return failures;
}

function packageEntry(packagePath, packageJson, disposition, workspacePatterns, openCorePaths) {
  const dependencies = {};
  for (const field of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'devDependencies',
  ]) {
    dependencies[field] = packageJson[field] ?? {};
  }

  return {
    path: packagePath,
    // The pnpm workspace root is a private repository manifest, not a
    // workspace package selected by pnpm-workspace.yaml.
    workspace: packagePath !== '.' && isWorkspacePath(packagePath, workspacePatterns),
    open_core: openCorePaths.includes(packagePath),
    name: packageJson.name ?? null,
    version: packageJson.version ?? null,
    private: packageJson.private === true,
    target: disposition
      ? {
          path: disposition.target_path,
          name: disposition.target_package,
          publish: disposition.publish_target,
          disposition: disposition.disposition,
        }
      : null,
    exports: packageJson.exports ?? null,
    bins: packageJson.bin ?? null,
    public_entry_points: {
      main: packageJson.main ?? null,
      module: packageJson.module ?? null,
      browser: packageJson.browser ?? null,
      types: packageJson.types ?? null,
      typesVersions: packageJson.typesVersions ?? null,
    },
    files: packageJson.files ?? null,
    dependencies,
  };
}

function countFiles(directory) {
  let count = 0;
  const visit = (path) => {
    let entries;
    try {
      entries = readdirSync(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = join(path, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) count += 1;
    }
  };
  visit(directory);
  return count;
}

function discoverGeneratedAssets(authority) {
  const candidates = new Map();
  const directoryNames = new Set(authority.generated_assets?.directory_names ?? []);
  const fileNames = new Set(authority.generated_assets?.file_names ?? []);

  const visit = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const path = rel(absolute);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          if (directoryNames.has(entry.name)) candidates.set(path, absolute);
          continue;
        }
        visit(absolute);
      } else if (entry.isFile() && fileNames.has(entry.name)) {
        candidates.set(path, absolute);
      }
    }
  };

  for (const root of ['apps', 'packages', 'docs']) {
    const absolute = join(ROOT, root);
    if (existsSync(absolute)) visit(absolute);
  }
  for (const fileName of fileNames) {
    const absolute = join(ROOT, fileName);
    if (existsSync(absolute)) candidates.set(fileName, absolute);
  }

  const known = new Map(
    (authority.generated_assets?.known_sources ?? []).map((item) => [item.path, item]),
  );
  return [...candidates.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, absolute]) => {
    const metadata = known.get(path);
    const sourcePaths = metadata?.source_paths ?? [];
    const fallbackSource = path.match(/^(.*)\/(?:dist|dist-web|dist-native)$/)?.[1];
    const inferredSource = fallbackSource && existsSync(join(ROOT, fallbackSource, 'src'))
      ? `${fallbackSource}/src`
      : null;
    return {
      path,
      kind: path.endsWith('.json') ? 'generated-metadata' : path.split('/').at(-1),
      exists: true,
      file_count: statSync(absolute).isDirectory() ? countFiles(absolute) : 1,
      source: metadata?.source ?? inferredSource,
      source_paths: sourcePaths,
      source_paths_present: sourcePaths.map((sourcePath) => ({
        path: sourcePath,
        exists: existsSync(join(ROOT, sourcePath)),
      })),
      reproducible_command: metadata?.reproducible_command ?? null,
      authority_status: metadata?.status ?? 'needs-source-and-command-review',
    };
  });
}

function buildInventory(authority) {
  const workspacePatterns = parseWorkspacePatterns();
  const renameRows = parseRenameMap();
  const renameByPath = new Map();
  const currentRenamePaths = new Set();
  const failures = [
    ...validateAuthorityDocuments(authority),
    ...validateAllowlist(authority),
  ];

  for (const row of renameRows) {
    if (currentRenamePaths.has(row.current_path)) {
      failures.push(`duplicate package disposition: ${row.current_path}`);
    }
    currentRenamePaths.add(row.current_path);
    if (!renameByPath.has(row.target_path)) renameByPath.set(row.target_path, row);
    if (!renameByPath.has(row.current_path)) renameByPath.set(row.current_path, row);
  }

  const openCore = readJson(OPEN_CORE_PATH);
  failures.push(...validateManifestAuthority(openCore, authority));
  failures.push(...validateTrackedSurfaces(authority, openCore));
  const openCorePaths = openCore.open_core?.packages ?? [];
  const packages = packageManifestPaths().map((manifestPath) => {
    const manifestRelativePath = rel(manifestPath);
    const packagePath = manifestRelativePath === 'package.json'
      ? '.'
      : manifestRelativePath.replace(/\/package\.json$/, '');
    return packageEntry(
      packagePath,
      readJson(manifestPath),
      renameByPath.get(packagePath),
      workspacePatterns,
      openCorePaths,
    );
  });

  const packagePaths = new Set(packages.map((pkg) => pkg.path));
  for (const packageRecord of packages) {
    if (!renameByPath.has(packageRecord.path)) {
      failures.push(`package has no disposition in PACKAGE_RENAME_MAP.md: ${packageRecord.path}`);
    }
  }
  for (const row of renameRows) {
    if (!packagePaths.has(row.current_path) && !packagePaths.has(row.target_path)) {
      failures.push(`package disposition has no current or target manifest: ${row.current_path} -> ${row.target_path}`);
    }
  }
  for (const path of openCorePaths) {
    if (!packagePaths.has(path)) failures.push(`Open Core package has no manifest: ${path}`);
    if (!renameByPath.has(path)) failures.push(`Open Core package has no disposition: ${path}`);
  }
  for (const packageRecord of packages) {
    if (packageRecord.workspace && !packagePaths.has(packageRecord.path)) {
      failures.push(`workspace path has no package manifest: ${packageRecord.path}`);
    }
  }

  const generatedAssets = discoverGeneratedAssets(authority);
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    authority: {
      config: rel(AUTHORITY_PATH),
      documents: authority.documents,
    },
    workspace: {
      config: rel(WORKSPACE_PATH),
      patterns: workspacePatterns,
      paths: packages.filter((pkg) => pkg.workspace).map((pkg) => pkg.path),
    },
    open_core: {
      manifest: rel(OPEN_CORE_PATH),
      paths: openCorePaths,
    },
    packages,
    generated_assets: generatedAssets,
    summary: {
      package_manifest_count: packages.length,
      workspace_package_count: packages.filter((pkg) => pkg.workspace).length,
      open_core_package_count: openCorePaths.length,
      generated_asset_path_count: generatedAssets.length,
      missing_dispositions: failures.filter((failure) => failure.includes('no disposition')).length,
      failures,
    },
  };
}

function main() {
  const authority = readJson(AUTHORITY_PATH);
  const inventory = buildInventory(authority);
  const json = process.argv.includes('--json');
  const check = process.argv.includes('--check');

  if (json) {
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
  } else {
    console.log(`SpiderByte release inventory: ${String(inventory.summary.package_manifest_count)} package manifests`);
    console.log(`Workspace packages: ${String(inventory.summary.workspace_package_count)}`);
    console.log(`Open Core packages: ${String(inventory.summary.open_core_package_count)}`);
    console.log(`Generated asset paths: ${String(inventory.summary.generated_asset_path_count)}`);
    if (inventory.summary.failures.length > 0) {
      console.error('Inventory findings:');
      for (const failure of inventory.summary.failures) console.error(`  - ${failure}`);
    }
  }

  if (check && inventory.summary.failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
