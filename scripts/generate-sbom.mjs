#!/usr/bin/env node
/** Generate a deterministic, lockfile-resolved CycloneDX 1.6 SBOM. */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const LOCK_PATH = join(ROOT, 'pnpm-lock.yaml');
const OUTPUT = join(ROOT, 'sbom.cdx.json');
const LICENSE_OVERRIDES_PATH = join(ROOT, 'config/dependency-license-overrides.json');

function unquote(value) {
  return value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1).replaceAll("''", "'") : value;
}

function coordinate(key) {
  const bare = unquote(key).replace(/\(.+$/, '');
  const splitAt = bare.lastIndexOf('@');
  if (splitAt <= 0) throw new Error(`invalid pnpm package key: ${key}`);
  return { name: bare.slice(0, splitAt), version: bare.slice(splitAt + 1) };
}

function dependencyLine(line) {
  const match = /^      ('[^']+'|[^:]+): (.+)$/.exec(line);
  if (match === null) return undefined;
  return { name: unquote(match[1]), version: unquote(match[2]).replace(/\(.+$/, '') };
}

function parsePnpmLock(text) {
  const lines = text.split('\n');
  const sections = new Map();
  for (const [index, line] of lines.entries()) {
    if (/^[a-z][a-zA-Z]+:$/.test(line)) sections.set(line.slice(0, -1), index);
  }
  const packageStart = sections.get('packages');
  const snapshotStart = sections.get('snapshots');
  const importerStart = sections.get('importers');
  if (packageStart === undefined || snapshotStart === undefined || importerStart === undefined) {
    throw new Error('pnpm lockfile must contain importers, packages, and snapshots');
  }

  const packages = new Map();
  let current;
  for (const line of lines.slice(packageStart + 1, snapshotStart)) {
    const entry = /^  ('[^']+'|\S[^:]*):$/.exec(line);
    if (entry !== null) {
      current = coordinate(entry[1]);
      packages.set(`${current.name}@${current.version}`, { ...current });
      continue;
    }
    const integrity = /^    resolution: \{integrity: ([^,}]+)[,}]/.exec(line);
    if (integrity !== null && current !== undefined) {
      packages.get(`${current.name}@${current.version}`).integrity = unquote(integrity[1]);
    }
  }

  const snapshots = new Map();
  let snapshotRef;
  let inDependencies = false;
  for (const line of lines.slice(snapshotStart + 1)) {
    const entry = /^  ('[^']+'|\S[^:]*):(?: \{\})?$/.exec(line);
    if (entry !== null) {
      const value = coordinate(entry[1]);
      snapshotRef = `${value.name}@${value.version}`;
      if (!snapshots.has(snapshotRef)) snapshots.set(snapshotRef, new Set());
      inDependencies = false;
      continue;
    }
    if (/^    (dependencies|optionalDependencies|peerDependencies):$/.test(line)) {
      inDependencies = true;
      continue;
    }
    if (/^    \S/.test(line)) inDependencies = false;
    if (!inDependencies || snapshotRef === undefined) continue;
    const dependency = dependencyLine(line);
    if (dependency === undefined || dependency.version.startsWith('link:')) continue;
    snapshots.get(snapshotRef).add(`${dependency.name}@${dependency.version}`);
  }

  const importers = new Map();
  let importer;
  let importerField;
  let importerDependency;
  for (const line of lines.slice(importerStart + 1, packageStart)) {
    const entry = /^  (\S.*):$/.exec(line);
    if (entry !== null) {
      importer = unquote(entry[1]);
      importers.set(importer, new Map());
      importerField = undefined;
      importerDependency = undefined;
      continue;
    }
    if (/^    (dependencies|devDependencies|optionalDependencies|peerDependencies):$/.test(line)) {
      importerField = line.trim().slice(0, -1);
      continue;
    }
    const dep = /^      ('[^']+'|[^:]+):$/.exec(line);
    if (dep !== null && importer !== undefined && importerField !== undefined) {
      importerDependency = unquote(dep[1]);
      continue;
    }
    const version = /^        version: (.+)$/.exec(line);
    if (version !== null && importer !== undefined && importerDependency !== undefined) {
      importers.get(importer).set(importerDependency, unquote(version[1]).replace(/\(.+$/, ''));
    }
  }
  return { packages, snapshots, importers };
}

function packageDirs() {
  const dirs = ['.'];
  for (const parent of ['apps', 'packages']) {
    for (const entry of readdirSync(join(ROOT, parent), { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(ROOT, parent, entry.name, 'package.json'))) {
        dirs.push(`${parent}/${entry.name}`);
      }
    }
  }
  return dirs;
}

function installedMetadata() {
  const metadata = new Map();
  const store = join(ROOT, 'node_modules/.pnpm');
  if (!existsSync(store)) return metadata;
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const modules = join(store, entry.name, 'node_modules');
    if (!existsSync(modules)) continue;
    for (const first of readdirSync(modules, { withFileTypes: true })) {
      if (!first.isDirectory()) continue;
      const candidates = first.name.startsWith('@')
        ? readdirSync(join(modules, first.name), { withFileTypes: true })
          .filter((child) => child.isDirectory())
          .map((child) => join(modules, first.name, child.name, 'package.json'))
        : [join(modules, first.name, 'package.json')];
      for (const path of candidates) {
        if (!existsSync(path)) continue;
        const pkg = JSON.parse(readFileSync(path, 'utf8'));
        if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') continue;
        metadata.set(`${pkg.name}@${pkg.version}`, pkg);
      }
    }
  }
  return metadata;
}

function licenseExpression(pkg) {
  if (typeof pkg?.license === 'string' && pkg.license.trim().length > 0) return pkg.license.trim();
  if (Array.isArray(pkg?.licenses)) {
    const values = pkg.licenses.map((item) => typeof item === 'string' ? item : item?.type).filter(Boolean);
    if (values.length > 0) return values.join(' OR ');
  }
  return 'UNKNOWN';
}

function wildcardMatches(pattern, name) {
  const wildcard = pattern.indexOf('*');
  if (wildcard === -1) return pattern === name;
  return name.startsWith(pattern.slice(0, wildcard)) && name.endsWith(pattern.slice(wildcard + 1));
}

function resolvedLicense(name, pkg, overrides) {
  const manifestLicense = licenseExpression(pkg);
  if (manifestLicense !== 'UNKNOWN' && !manifestLicense.startsWith('SEE LICENSE')) {
    return { expression: manifestLicense, source: 'installed-package-manifest' };
  }
  const override = overrides.find((item) => wildcardMatches(item.pattern, name));
  if (override === undefined) return { expression: 'UNKNOWN', source: 'unavailable' };
  return { expression: override.license, source: 'reviewed-override', evidence: override.evidence };
}

function purl(name, version) {
  const slash = name.startsWith('@') ? name.indexOf('/') : -1;
  const namespace = slash > 0 ? `${encodeURIComponent(name.slice(1, slash))}/` : '';
  const packageName = slash > 0 ? name.slice(slash + 1) : name;
  return `pkg:npm/${namespace}${encodeURIComponent(packageName)}@${encodeURIComponent(version)}`;
}

function hashFromIntegrity(integrity) {
  if (typeof integrity !== 'string') return undefined;
  const match = /^(sha(?:256|384|512))-(.+)$/.exec(integrity);
  if (match === null) return undefined;
  return { alg: match[1].toUpperCase().replace('SHA', 'SHA-'), content: Buffer.from(match[2], 'base64').toString('hex') };
}

function repositoryReference(repository) {
  const url = typeof repository === 'string' ? repository : repository?.url;
  return typeof url === 'string' ? [{ type: 'vcs', url: url.replace(/^git\+/, '') }] : undefined;
}

function deterministicUuid(lockText) {
  const bytes = createHash('sha256').update(lockText).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createBom(lockText, workspaceManifests, metadata, licenseOverrides = []) {
  const lock = parsePnpmLock(lockText);
  const components = [];
  const componentRefs = new Set();
  const workspaceByName = new Map();
  for (const [path, pkg] of workspaceManifests) {
    const ref = `workspace:${pkg.name}@${pkg.version}`;
    workspaceByName.set(pkg.name, ref);
    componentRefs.add(ref);
    components.push({
      type: pkg.private ? 'application' : 'library',
      'bom-ref': ref,
      name: pkg.name,
      version: pkg.version,
      licenses: [{ expression: licenseExpression(pkg) }],
      purl: purl(pkg.name, pkg.version),
      externalReferences: repositoryReference(pkg.repository),
      properties: [{ name: 'org.spiderbyte.source.path', value: path }],
    });
  }
  for (const [ref, item] of lock.packages) {
    const pkg = metadata.get(ref);
    const hash = hashFromIntegrity(item.integrity);
    const license = resolvedLicense(item.name, pkg, licenseOverrides);
    componentRefs.add(ref);
    components.push({
      type: 'library',
      'bom-ref': ref,
      name: item.name,
      version: item.version,
      licenses: [{ expression: license.expression }],
      purl: purl(item.name, item.version),
      hashes: hash === undefined ? undefined : [hash],
      externalReferences: repositoryReference(pkg?.repository),
      properties: [
        { name: 'org.spiderbyte.resolution', value: 'pnpm-lock.yaml' },
        { name: 'org.spiderbyte.license.source', value: license.source },
        license.evidence === undefined ? undefined : { name: 'org.spiderbyte.license.evidence', value: license.evidence },
      ].filter(Boolean),
    });
  }
  components.sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref']));

  const relationships = new Map();
  function addRelationship(ref, dependencies) {
    const set = relationships.get(ref) ?? new Set();
    for (const dependency of dependencies) if (componentRefs.has(dependency)) set.add(dependency);
    relationships.set(ref, set);
  }
  for (const [ref, deps] of lock.snapshots) addRelationship(ref, deps);
  for (const [path, pkg] of workspaceManifests) {
    const dependencies = [];
    for (const [name, version] of lock.importers.get(path) ?? []) {
      const workspaceRef = workspaceByName.get(name);
      if (workspaceRef !== undefined) dependencies.push(workspaceRef);
      else if (!version.startsWith('link:')) dependencies.push(`${name}@${version}`);
    }
    addRelationship(workspaceByName.get(pkg.name), dependencies);
  }
  const rootPackage = workspaceManifests.get('.');
  const rootRef = workspaceByName.get(rootPackage.name);
  addRelationship(rootRef, [...workspaceByName.values()].filter((ref) => ref !== rootRef));

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${deterministicUuid(lockText)}`,
    version: 1,
    metadata: {
      component: components.find((component) => component['bom-ref'] === rootRef),
      tools: { components: [{ type: 'application', name: 'generate-sbom.mjs', version: '2' }] },
      properties: [
        { name: 'org.spiderbyte.determinism', value: 'timestamp omitted; serial derived from sha256(pnpm-lock.yaml)' },
        { name: 'org.spiderbyte.source.lockfile', value: 'pnpm-lock.yaml' },
      ],
    },
    components,
    dependencies: [...relationships]
      .map(([ref, dependencies]) => ({ ref, dependsOn: [...dependencies].sort((a, b) => a.localeCompare(b)) }))
      .sort((a, b) => a.ref.localeCompare(b.ref)),
  };
}

function main() {
  const lockText = readFileSync(LOCK_PATH, 'utf8');
  const manifests = new Map(packageDirs().map((path) => [
    path,
    JSON.parse(readFileSync(join(ROOT, path, 'package.json'), 'utf8')),
  ]));
  const licenseRegistry = JSON.parse(readFileSync(LICENSE_OVERRIDES_PATH, 'utf8'));
  const bom = createBom(lockText, manifests, installedMetadata(), licenseRegistry.overrides);
  writeFileSync(OUTPUT, `${JSON.stringify(bom, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT} with ${String(bom.components.length)} resolved components.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { createBom, parsePnpmLock };
