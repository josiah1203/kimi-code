#!/usr/bin/env node
/**
 * Phase 1 package topology and npm tarball gate.
 *
 * The release inventory parses PACKAGE_RENAME_MAP.md, so this checker consumes
 * that inventory rather than maintaining a second package-name authority.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const INVENTORY_SCRIPT = join(ROOT, 'scripts/inventory-spiderbyte-release.mjs');
const DEPENDENCY_SECTIONS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
];
const FORBIDDEN_TARBALL_PATHS = [
  /^compat\//,
  /(^|\/)dist-web\//,
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)\.spiderbyte\//,
  /(^|\/)commercial\//,
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runInventory() {
  const result = spawnSync(process.execPath, [INVENTORY_SCRIPT, '--json', '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`release inventory failed: ${result.stderr || result.stdout}`.trim());
  }
  return JSON.parse(result.stdout);
}

function collectEntrypoints(value, paths = []) {
  if (typeof value === 'string') {
    paths.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectEntrypoints(item, paths);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectEntrypoints(item, paths);
  }
  return paths;
}

function entrypointIsPacked(entrypoint, files) {
  if (!entrypoint.startsWith('./')) return false;
  const path = entrypoint.slice(2);
  if (!path.includes('*')) return files.has(path);
  const expression = path
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replaceAll('*', '.*');
  return [...files].some((file) => new RegExp(`^${expression}$`).test(file));
}

function packDryRun(packagePath, cachePath) {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: join(ROOT, packagePath),
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: cachePath },
  });
  if (result.status !== 0) {
    return { error: (result.stderr || result.stdout).trim(), report: null };
  }
  try {
    const reports = JSON.parse(result.stdout);
    return { error: null, report: reports[0] ?? null };
  } catch {
    return { error: `npm pack returned invalid JSON: ${result.stdout}`, report: null };
  }
}

function checkPackageNames() {
  const inventory = runInventory();
  const failures = [...inventory.summary.failures];
  const workspaceNames = new Set(
    inventory.packages.filter((pkg) => pkg.workspace).map((pkg) => pkg.name),
  );
  const publishTargets = inventory.packages.filter((pkg) => pkg.target?.publish === true);
  const cachePath = mkdtempSync(join(tmpdir(), 'spiderbyte-package-audit-'));
  const packs = [];

  try {
    for (const pkg of inventory.packages) {
      if (pkg.target === null) continue;
      if (pkg.path !== pkg.target.path) {
        failures.push(`${pkg.path}: target path must be ${pkg.target.path}`);
      }
      if (pkg.name !== pkg.target.name) {
        failures.push(`${pkg.path}: package name ${pkg.name} must be ${pkg.target.name}`);
      }

      const manifest = readJson(join(ROOT, pkg.path === '.' ? 'package.json' : pkg.path, pkg.path === '.' ? '' : 'package.json'));
      for (const section of DEPENDENCY_SECTIONS) {
        for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
          if (pkg.workspace && (name.startsWith('@moonshot-ai/') || name.startsWith('@spiderbyte/legacy-'))) {
            failures.push(`${pkg.path}: ${section} references legacy package ${name}`);
          }
          if (specifier.startsWith('workspace:') && !workspaceNames.has(name)) {
            failures.push(`${pkg.path}: ${section} has workspace reference to unknown package ${name}`);
          }
        }
      }
    }

    for (const pkg of publishTargets) {
      const manifestPath = join(ROOT, pkg.path, 'package.json');
      const manifest = readJson(manifestPath);
      if (!pkg.name.startsWith('@spiderbyte/')) {
        failures.push(`${pkg.path}: publishable package must use the @spiderbyte scope`);
      }
      if (pkg.private) failures.push(`${pkg.path}: publish target must not be private`);
      if (!pkg.workspace) failures.push(`${pkg.path}: publish target must be in the workspace`);
      if (!pkg.open_core) failures.push(`${pkg.path}: publish target must be listed in open-core.json`);
      if (manifest.publishConfig?.access !== 'public') {
        failures.push(`${pkg.path}: publishConfig.access must be public`);
      }

      if (pkg.path === 'apps/cli') {
        const bins = Object.entries(manifest.bin ?? {});
        if (bins.length !== 1 || bins[0]?.[0] !== 'spyderbyte' || bins[0]?.[1] !== 'dist/main.mjs') {
          failures.push('apps/cli: bin must contain exactly spyderbyte -> dist/main.mjs');
        }
      }

      const packed = packDryRun(pkg.path, cachePath);
      if (packed.error !== null || packed.report === null) {
        failures.push(`${pkg.path}: npm pack --dry-run failed: ${packed.error ?? 'no report'}`);
        continue;
      }
      packs.push({ path: pkg.path, name: packed.report.name, files: packed.report.files.length });
      if (packed.report.name !== pkg.name) {
        failures.push(`${pkg.path}: packed name ${String(packed.report.name)} must be ${pkg.name}`);
      }
      const files = new Set(packed.report.files.map((file) => file.path));
      for (const file of files) {
        if (FORBIDDEN_TARBALL_PATHS.some((pattern) => pattern.test(file))) {
          failures.push(`${pkg.path}: forbidden tarball path ${file}`);
        }
      }

      const entrypoints = new Set([
        ...collectEntrypoints(manifest.exports),
        ...collectEntrypoints(manifest.main),
        ...collectEntrypoints(manifest.module),
        ...collectEntrypoints(manifest.types),
        ...collectEntrypoints(manifest.bin),
      ]);
      for (const entrypoint of entrypoints) {
        if (!entrypoint.startsWith('./')) continue;
        if (entrypoint.includes('..')) {
          failures.push(`${pkg.path}: entrypoint escapes the package: ${entrypoint}`);
        } else if (!entrypointIsPacked(entrypoint, files)) {
          failures.push(`${pkg.path}: packed files do not contain entrypoint ${entrypoint}`);
        }
      }
    }
  } finally {
    rmSync(cachePath, { recursive: true, force: true });
  }

  return {
    ok: failures.length === 0,
    publish_target_count: publishTargets.length,
    packs,
    failures,
  };
}

function main() {
  const result = checkPackageNames();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    console.log(`SpiderByte package-name audit passed for ${String(result.publish_target_count)} publish targets.`);
  } else {
    console.error(`SpiderByte package-name audit found ${String(result.failures.length)} failure(s):`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
  }
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { checkPackageNames };
