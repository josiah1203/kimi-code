#!/usr/bin/env node
/** Build, normalize, verify, and install the complete publishable package set. */

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText } from './check-secrets.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const INVENTORY = join(ROOT, 'scripts/inventory-spiderbyte-release.mjs');

function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${commandName} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function writeString(buffer, offset, length, value) {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8');
}

function writeOctal(buffer, offset, length, value) {
  writeString(buffer, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
}

function tarPath(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: '' };
  for (let index = path.lastIndexOf('/'); index > 0; index = path.lastIndexOf('/', index - 1)) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error(`tar path exceeds ustar limits: ${path}`);
}

function tarEntry(path, body, mode, type = '0', link = '') {
  const header = Buffer.alloc(512);
  const split = tarPath(path);
  writeString(header, 0, 100, split.name);
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, body.length);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeString(header, 156, 1, type);
  writeString(header, 157, 100, link);
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  writeString(header, 345, 155, split.prefix);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, body, padding]);
}

function walk(path, output = []) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) walk(child, output);
    else output.push(child);
  }
  return output;
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function canonicalizeTarball(source, output, work) {
  const unpacked = join(work, 'unpacked');
  mkdirSync(unpacked, { recursive: true });
  execFileSync('tar', ['-xzf', source, '-C', unpacked]);
  const manifestPath = join(unpacked, 'package/package.json');
  writeFileSync(manifestPath, `${JSON.stringify(sortJson(JSON.parse(readFileSync(manifestPath, 'utf8'))), null, 2)}\n`);
  const entries = [];
  for (const path of walk(unpacked).sort((a, b) => a.localeCompare(b))) {
    const archivePath = relative(unpacked, path);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) entries.push(tarEntry(archivePath, Buffer.alloc(0), stat.mode & 0o777, '2', readlinkSync(path)));
    else entries.push(tarEntry(archivePath, readFileSync(path), stat.mode & 0o777));
  }
  const tar = Buffer.concat([...entries, Buffer.alloc(1024)]);
  writeFileSync(output, gzipSync(tar, { level: 9, mtime: 0 }));
  return unpacked;
}

function archivePackageDirectory(packageDirectory, output) {
  const entries = [];
  for (const path of walk(packageDirectory).toSorted((a, b) => a.localeCompare(b))) {
    const archivePath = join('package', relative(packageDirectory, path)).replaceAll('\\', '/');
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) entries.push(tarEntry(archivePath, Buffer.alloc(0), stat.mode & 0o777, '2', readlinkSync(path)));
    else entries.push(tarEntry(archivePath, readFileSync(path), stat.mode & 0o777));
  }
  const tar = Buffer.concat([...entries, Buffer.alloc(1024)]);
  writeFileSync(output, gzipSync(tar, { level: 9, mtime: 0 }));
}

function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/u.exec(version);
  if (match === null) throw new Error(`cannot create rehearsal version from ${version}`);
  return `${match[1]}.${match[2]}.${String(Number(match[3]) + 1)}${match[4]}`;
}

function makeUpgradeArtifact(artifact, destination) {
  const manifestPath = join(artifact.unpacked, 'package/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const upgradeVersion = bumpPatch(manifest.version);
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, version: upgradeVersion }, null, 2)}\n`);
  const output = join(destination, `${artifact.name.replaceAll('/', '-')}-${upgradeVersion}.tgz`);
  archivePackageDirectory(join(artifact.unpacked, 'package'), output);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...artifact, upgradePath: output, upgradeVersion };
}

function installedPackageVersion(root, packageName) {
  const manifestPath = join(root, 'node_modules', packageName, 'package.json');
  return JSON.parse(readFileSync(manifestPath, 'utf8')).version;
}

function rehearseUpgradeRollback(artifacts, temp, cache) {
  const target = artifacts.find((artifact) => artifact.name === '@spiderbyte/sdk');
  if (target === undefined) throw new Error('upgrade/rollback rehearsal target @spiderbyte/sdk is missing');

  const upgradeDirectory = join(temp, 'upgrade-rollback-artifact');
  mkdirSync(upgradeDirectory, { recursive: true });
  const upgraded = makeUpgradeArtifact(target, upgradeDirectory);
  const root = join(temp, 'upgrade-rollback');
  mkdirSync(root, { recursive: true });
  const packageFiles = Object.fromEntries(artifacts.map((artifact) => [artifact.name, `file:${artifact.path}`]));
  const packageJsonPath = join(root, 'package.json');
  const writeHarnessManifest = (sdkPath) => {
    writeFileSync(
      packageJsonPath,
      `${JSON.stringify(
        {
          name: 'spiderbyte-upgrade-rollback-rehearsal',
          private: true,
          type: 'module',
          packageManager: 'pnpm@10.33.0',
          dependencies: { '@spiderbyte/sdk': `file:${sdkPath}` },
          pnpm: { overrides: { ...packageFiles, '@spiderbyte/sdk': `file:${sdkPath}` } },
        },
        null,
        2,
      )}\n`,
    );
  };

  const install = () =>
    command('pnpm', ['install', '--ignore-scripts', '--config.engine-strict=false'], {
      cwd: root,
      env: { ...process.env, npm_config_cache: cache, npm_config_engine_strict: 'false' },
    });

  writeHarnessManifest(target.path);
  install();
  if (installedPackageVersion(root, target.name) !== target.version) throw new Error(`${target.name}: initial rehearsal install resolved the wrong version`);

  writeHarnessManifest(upgraded.upgradePath);
  install();
  if (installedPackageVersion(root, target.name) !== upgraded.upgradeVersion) throw new Error(`${target.name}: upgrade rehearsal did not resolve the upgraded version`);

  writeHarnessManifest(target.path);
  install();
  if (installedPackageVersion(root, target.name) !== target.version) throw new Error(`${target.name}: rollback rehearsal did not restore the original version`);

  // eslint-disable-next-line no-console
  console.log(`Upgrade/rollback rehearsal passed for ${target.name}: ${target.version} -> ${upgraded.upgradeVersion} -> ${target.version}.`);
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function packOnce(pkg, destination, cache) {
  const seed = join(destination, 'seed');
  const normalize = join(destination, 'normalize');
  mkdirSync(seed, { recursive: true });
  command('pnpm', ['pack', '--pack-destination', seed], { cwd: join(ROOT, pkg.path), env: { ...process.env, npm_config_cache: cache, npm_config_engine_strict: 'false' } });
  const seedTarball = join(seed, readdirSync(seed).find((name) => name.endsWith('.tgz')));
  const output = join(destination, basename(seedTarball));
  const unpacked = canonicalizeTarball(seedTarball, output, normalize);
  return { output, unpacked };
}

function main() {
  const inventory = JSON.parse(command(process.execPath, [INVENTORY, '--json', '--check'], { cwd: ROOT }));
  const packages = inventory.packages.filter((pkg) => pkg.target?.publish === true);
  const temp = mkdtempSync('/tmp/sb-art-');
  const cache = join(temp, 'npm-cache');
  const artifacts = [];
  try {
    for (const [index, pkg] of packages.entries()) {
      command('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: join(ROOT, pkg.path), env: { ...process.env, npm_config_cache: cache, npm_config_engine_strict: 'false' } });
      command('npm', ['publish', '--dry-run', '--json', '--ignore-scripts'], { cwd: join(ROOT, pkg.path), env: { ...process.env, npm_config_cache: cache, npm_config_engine_strict: 'false' } });
      const firstDir = join(temp, 'a', String(index));
      const secondDir = join(temp, 'b', String(index));
      mkdirSync(firstDir, { recursive: true });
      mkdirSync(secondDir, { recursive: true });
      const first = packOnce(pkg, firstDir, cache);
      const second = packOnce(pkg, secondDir, cache);
      const firstDigest = digest(first.output);
      const secondDigest = digest(second.output);
      if (firstDigest !== secondDigest) throw new Error(`${pkg.name}: normalized package artifact is not reproducible`);
      const manifest = JSON.parse(readFileSync(join(first.unpacked, 'package/package.json'), 'utf8'));
      if (manifest.name !== pkg.name || manifest.version !== pkg.version) throw new Error(`${pkg.name}: packed manifest identity does not match inventory`);
      const secretFindings = [];
      for (const path of walk(first.unpacked)) {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.size > 5 * 1024 * 1024) continue;
        const bytes = readFileSync(path);
        if (!bytes.includes(0)) secretFindings.push(...scanText(bytes.toString('utf8'), `${pkg.name}/${relative(first.unpacked, path)}`));
      }
      if (secretFindings.length > 0) throw new Error(secretFindings.join('\n'));
      artifacts.push({ name: pkg.name, version: pkg.version, sha256: firstDigest, path: first.output, unpacked: first.unpacked });
    }

    const installRoot = join(temp, 'install');
    mkdirSync(installRoot);
    const localPackages = Object.fromEntries(artifacts.map((artifact) => [artifact.name, `file:${artifact.path}`]));
    writeFileSync(join(installRoot, 'package.json'), `${JSON.stringify({ private: true, type: 'module', packageManager: 'pnpm@10.33.0', dependencies: localPackages, pnpm: { overrides: localPackages } }, null, 2)}\n`);
    command('pnpm', ['install', '--ignore-scripts', '--config.engine-strict=false'], { cwd: installRoot, env: { ...process.env, npm_config_cache: cache, npm_config_engine_strict: 'false' } });
    for (const artifact of artifacts) {
      command(process.execPath, ['--input-type=module', '--eval', `console.log(import.meta.resolve(${JSON.stringify(artifact.name)}))`], { cwd: installRoot });
    }
    rehearseUpgradeRollback(artifacts, temp, cache);
    console.log(`Package artifact verification passed for ${String(artifacts.length)} targets.`);
    for (const artifact of artifacts) console.log(`  ${artifact.sha256}  ${artifact.name}@${artifact.version}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
