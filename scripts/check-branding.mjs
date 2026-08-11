#!/usr/bin/env node
/**
 * Repository branding gate for the SpiderByte Open Core distribution.
 *
 * The scan covers active source, manifests, configuration, CI, and
 * documentation. Compatibility material is quarantined under compat/ and is
 * checked by its own deprecation policy; it is not part of the supported
 * product tree. Intentional upstream/provider/legal references are permitted
 * only by an exact path + token entry in the release authority file.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const AUTHORITY_PATH = join(ROOT, 'config/spiderbyte-release-authority.json');
const MANIFEST_PATH = join(ROOT, 'open-core.json');
const SOURCE_EXTENSIONS = new Set([
  '.cjs', '.css', '.html', '.js', '.json', '.jsx', '.mjs', '.md', '.mts',
  '.ts', '.tsx', '.toml', '.txt', '.yaml', '.yml',
]);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.tmp',
  'node_modules',
  'coverage',
  'dist',
  'dist-native',
  'dist-web',
]);
const ACTIVE_ROOTS = [
  'apps',
  'packages',
  'docs',
  'config',
  '.github',
  'README.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'NOTICE',
  'THIRD_PARTY_NOTICES.md',
  'open-core.json',
  'package.json',
  'pnpm-workspace.yaml',
  'flake.nix',
];

// These files are release authority records, not product surfaces. They
// intentionally record retired names so a reviewer can trace the migration
// and verify that compatibility decisions are explicit. Keep this list small
// and exact; ordinary release documentation remains in the scan.
const AUTHORITY_METADATA_PATHS = new Set([
  'config/spiderbyte-release-authority.json',
  'docs/release/SPIDERBYTE_OPEN_CORE_BASELINE.json',
  'docs/release/PACKAGE_RENAME_MAP.md',
]);

const LEGACY_PRODUCT_PATTERNS = [
  { id: 'kimi-code', regex: /kimi[ -]?code/gi },
  { id: 'kimi-code-env', regex: /KIMI_CODE_[A-Z0-9_]+/g },
  { id: 'kimi-storage', regex: /\.kimi-code\b/gi },
  { id: 'kimi-cli-constructor', regex: /new\s+Command\(\s*['"]kimi['"]\s*\)/g },
  { id: 'kimi-cli-argv', regex: /\[\s*['"]node['"]\s*,\s*['"]kimi['"]\s*,/g },
];

function rel(abs) {
  return relative(ROOT, abs).split('\\').join('/');
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name) && entry.name !== 'compat') {
        files.push(...walk(absolute));
      }
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
      files.push(absolute);
    }
  }
  return files;
}

function filesForRoot(root) {
  const absolute = join(ROOT, root);
  if (!existsSync(absolute)) return [];
  return statSync(absolute).isFile() ? [absolute] : walk(absolute);
}

function loadAuthority() {
  const authority = JSON.parse(readFileSync(AUTHORITY_PATH, 'utf8'));
  const allowlist = authority.allowlists?.branding;
  if (!Array.isArray(allowlist)) throw new Error('branding allowlist is missing');
  for (const [index, entry] of allowlist.entries()) {
    for (const field of ['path', 'token', 'category', 'reason', 'owner', 'review_by']) {
      if (typeof entry[field] !== 'string' || entry[field].length === 0) {
        throw new Error(`branding allowlist entry ${String(index)} is missing ${field}`);
      }
    }
    if (!existsSync(join(ROOT, entry.path))) {
      throw new Error(`branding allowlist path does not exist: ${entry.path}`);
    }
  }
  return authority;
}

function isAllowed(path, matchText, authority) {
  return (authority.allowlists?.branding ?? []).some((entry) =>
    entry.path === path && matchText.toLowerCase().includes(entry.token.toLowerCase()),
  );
}

function scanBrandingText(path, text, authority = { allowlists: { branding: [] } }) {
  const findings = [];
  const lines = text.split('\n');
  for (const [lineIndex, line] of lines.entries()) {
    for (const pattern of LEGACY_PRODUCT_PATTERNS) {
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(line);
      pattern.regex.lastIndex = 0;
      if (match === null || isAllowed(path, match[0], authority)) continue;
      findings.push({
        path,
        line: lineIndex + 1,
        pattern: pattern.id,
        text: line.trim().slice(0, 220),
      });
    }
  }
  return findings;
}

function scanBranding() {
  const authority = loadAuthority();
  const findings = [];
  const seen = new Set();
  for (const root of ACTIVE_ROOTS) {
    for (const file of filesForRoot(root)) {
      const path = rel(file);
      if (seen.has(path)) continue;
      seen.add(path);
      if (AUTHORITY_METADATA_PATHS.has(path)) continue;
      findings.push(...scanBrandingText(path, readFileSync(file, 'utf8'), authority));
    }
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const frontendSource = manifest.open_core?.external_frontend_source;
  if (frontendSource?.required_for_open_core !== false && frontendSource?.path !== undefined && !existsSync(join(ROOT, frontendSource.path))) {
    findings.push({
      path: frontendSource.path,
      line: 1,
      pattern: 'missing-frontend-source',
      text: 'required frontend source is not present in this checkout',
    });
  }

  const cliPackage = JSON.parse(readFileSync(join(ROOT, 'apps/cli/package.json'), 'utf8'));
  if (cliPackage.bin?.spyderbyte !== 'dist/main.mjs' || Object.keys(cliPackage.bin ?? {}).length !== 1) {
    findings.push({
      path: 'apps/cli/package.json',
      line: 1,
      pattern: 'canonical-bin',
      text: 'apps/cli must expose exactly one executable: spyderbyte',
    });
  }

  const desktopPackagePath = join(ROOT, 'apps/spiderbyte-vscode/package.json');
  if (existsSync(desktopPackagePath)) {
    const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, 'utf8'));
    if (desktopPackage.displayName !== 'SpiderByte') {
      findings.push({
        path: 'apps/spiderbyte-vscode/package.json',
        line: 1,
        pattern: 'desktop-display-name',
        text: `desktop displayName is ${String(desktopPackage.displayName ?? '(unset)')}`,
      });
    }
  }

  return findings;
}

function main() {
  const findings = scanBranding();
  const output = { ok: findings.length === 0, findings };
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else if (findings.length === 0) {
    console.log('SpiderByte branding check passed.');
  } else {
    console.error(`SpiderByte branding check found ${String(findings.length)} finding(s):`);
    for (const finding of findings) {
      console.error(`  ${finding.path}:${String(finding.line)} [${finding.pattern}] — ${finding.text}`);
    }
  }
  if (!output.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { scanBranding, scanBrandingText };
