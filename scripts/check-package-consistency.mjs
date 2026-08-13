#!/usr/bin/env node
/**
 * Check the package topology as a whole.
 *
 * `check-package-names.mjs` deliberately performs the more expensive tarball
 * checks. This gate is the cheap, dependency-free consistency check used by
 * clean-checkout bootstrap: pnpm workspace membership, flake membership,
 * package-map rows, Open Core disposition, names, and the canonical CLI bin
 * must all agree.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const IGNORED = new Set(['.git', '.tmp', 'node_modules', 'coverage', '.next', 'dist', 'dist-native', 'dist-web']);
const DEPENDENCY_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function rel(path) {
  return relative(ROOT, path).split('\\').join('/') || '.';
}

function workspacePatterns() {
  const patterns = [];
  let inPackages = false;
  for (const line of readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8').split('\n')) {
    if (/^packages:\s*$/u.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/u.test(line)) break;
    if (inPackages) {
      const match = line.match(/^\s*-\s+(.+?)\s*$/u);
      if (match) patterns.push(match[1]);
    }
  }
  return patterns;
}

function workspacePaths() {
  const paths = new Set();
  for (const pattern of workspacePatterns()) {
    if (pattern.startsWith('!')) continue;
    if (pattern.endsWith('/*')) {
      const base = pattern.slice(0, -2);
      const absolute = join(ROOT, base);
      if (!existsSync(absolute)) continue;
      for (const entry of readdirSync(absolute, { withFileTypes: true })) {
        if (entry.isDirectory() && existsSync(join(absolute, entry.name, 'package.json'))) {
          paths.add(`${base}/${entry.name}`);
        }
      }
      continue;
    }
    if (existsSync(join(ROOT, pattern, 'package.json'))) paths.add(pattern);
  }
  return paths;
}

function packageManifestPaths() {
  const manifests = [];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (IGNORED.has(entry.name)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name === 'package.json') manifests.push(absolute);
    }
  };
  visit(ROOT);
  return manifests.toSorted((left, right) => left.localeCompare(right));
}

function parseFlake() {
  const source = readFileSync(join(ROOT, 'flake.nix'), 'utf8');
  const parse = (label, itemPattern) => {
    const match = source.match(new RegExp(`${label}\\s*=\\s*\\[(.*?)\\]`, 'su'));
    if (match === null) throw new Error(`flake.nix is missing ${label}`);
    return [...match[1].matchAll(itemPattern)].map((item) => item[1] ?? item[0]);
  };
  return {
    paths: parse('workspacePaths', /\.\/(\S+)/gu).map((path) => `./${path}`),
    names: parse('workspaceNames', /"([^"]+)"/gu),
  };
}

function parsePackageMap() {
  const rows = new Map();
  for (const line of readFileSync(join(ROOT, 'docs/release/PACKAGE_RENAME_MAP.md'), 'utf8').split('\n')) {
    if (!line.startsWith('|') || /^\|\s*:?-{3,}/u.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim().replaceAll('`', ''));
    if (cells.length < 6 || cells[0] === 'Current path') continue;
    rows.set(cells[0], {
      targetPath: cells[2],
      targetName: cells[3],
      publishTarget: cells[4] === 'Yes',
    });
  }
  return rows;
}

function checkPackageConsistency() {
  const failures = [];
  const workspace = workspacePaths();
  const flake = parseFlake();
  const flakePaths = new Set(flake.paths);
  const flakeNames = new Set(flake.names);
  const packageMap = parsePackageMap();
  const manifestPaths = packageManifestPaths();
  const manifests = new Map();
  const names = new Map();

  for (const manifest of manifestPaths) {
    const manifestRelativePath = rel(manifest);
    const path = manifestRelativePath === 'package.json'
      ? '.'
      : manifestRelativePath.replace(/\/package\.json$/u, '');
    if (path === '.') continue;
    const manifestJson = readJson(manifest);
    manifests.set(path, manifestJson);
    const previous = names.get(manifestJson.name);
    if (previous !== undefined) failures.push(`duplicate package name ${manifestJson.name}: ${previous}, ${path}`);
    names.set(manifestJson.name, path);

    const row = packageMap.get(path);
    if (row === undefined) failures.push(`${path}: missing row in PACKAGE_RENAME_MAP.md`);
    else {
      if (row.targetPath !== path) failures.push(`${path}: package map target path is ${row.targetPath}`);
      if (row.targetName !== manifestJson.name) failures.push(`${path}: package map target name is ${row.targetName}, manifest says ${manifestJson.name}`);
    }
  }

  for (const path of workspace) {
    const manifest = manifests.get(path);
    if (manifest === undefined) {
      failures.push(`${path}: workspace entry has no package manifest`);
      continue;
    }
    if (!flakePaths.has(`./${path}`)) failures.push(`${path}: missing from flake.nix workspacePaths`);
    if (!flakeNames.has(manifest.name)) failures.push(`${path}: ${manifest.name} missing from flake.nix workspaceNames`);
    for (const section of DEPENDENCY_SECTIONS) {
      for (const [dependency, specifier] of Object.entries(manifest[section] ?? {})) {
        if (typeof specifier !== 'string' || !specifier.startsWith('workspace:')) continue;
        if (!names.has(dependency)) failures.push(`${path}: ${section} references unknown workspace package ${dependency}`);
      }
    }
  }

  for (const path of flakePaths) {
    const normalized = path.replace(/^\.\//u, '');
    if (normalized === '.' || normalized === 'docs') continue;
    if (!workspace.has(normalized)) failures.push(`flake.nix workspacePaths contains non-workspace path ${path}`);
  }
  for (const name of flakeNames) {
    if (!names.has(name)) failures.push(`flake.nix workspaceNames contains unknown package ${name}`);
  }

  const openCore = readJson(join(ROOT, 'open-core.json'));
  const openCorePaths = new Set(openCore.open_core?.packages ?? []);
  for (const path of openCorePaths) {
    const manifest = manifests.get(path);
    if (manifest === undefined) failures.push(`open-core.json lists missing package ${path}`);
    else {
      if (!workspace.has(path)) failures.push(`open-core.json package is not a pnpm workspace package: ${path}`);
      if (manifest.private === true) failures.push(`open-core.json package is private: ${path}`);
      if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@spiderbyte/')) failures.push(`open-core.json package has non-canonical name: ${path}`);
      if (packageMap.get(path)?.publishTarget !== true) failures.push(`open-core.json package is not a publish target in the package map: ${path}`);
    }
  }

  const cli = manifests.get('apps/cli');
  if (cli === undefined) failures.push('apps/cli/package.json is missing');
  else if (JSON.stringify(cli.bin ?? {}) !== JSON.stringify({ spyderbyte: 'dist/main.mjs' })) failures.push('apps/cli must expose exactly spyderbyte -> dist/main.mjs');

  return {
    ok: failures.length === 0,
    workspace_count: workspace.size,
    manifest_count: manifests.size,
    open_core_count: openCorePaths.size,
    flake_path_count: flakePaths.size,
    flake_name_count: flakeNames.size,
    failures,
  };
}

function main() {
  const result = checkPackageConsistency();
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (result.ok) console.log(`SpiderByte package consistency passed for ${String(result.workspace_count)} workspace packages.`);
  else {
    console.error(`SpiderByte package consistency found ${String(result.failures.length)} failure(s):`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
  }
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { checkPackageConsistency };
