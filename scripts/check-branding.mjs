#!/usr/bin/env node
/**
 * Scan user-facing source and generated web assets for primary-product
 * references that must move to SpiderByte. Provider names, compatibility
 * aliases, implementation package names, and legal attribution are explicitly
 * documented exceptions rather than being silently rewritten.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const LEGACY_PRODUCT_REFERENCES = /\bKimi(?: Code)?\b|\bMoonshot\b/g;
const SOURCE_EXTENSIONS = new Set([
  '.css',
  '.cjs',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);
const ROOTS = [
  'apps/kimi-code/src',
  'apps/kimi-code/package.json',
  'apps/vscode/package.json',
  'apps/vscode/src',
  'apps/vscode/README.md',
  'docs/en',
  'docs/zh',
];
const WEB_SOURCE_ROOT = 'apps/web';
const WEB_BUNDLE_ROOT = 'apps/kimi-code/dist-web';

// These are the only references this gate deliberately permits. A provider
// label, a package/namespace/env name, a compatibility notice, or a legal
// attribution must remain distinguishable from the SpiderByte product name.
const DOCUMENTED_EXCEPTION = /@moonshot-ai|KIMI_|kimi-code|\.kimi-code|Kimi[A-Z]|Kimi-hosted|Kimi-compatible|Kimi Datasource|Kimi-built|Kimi-derived|Kimi interactive|Kimi\/v1|Moonshot AI|Kimi\/Moonshot|\b(?:author|harness|managed|platform|provider|OAuth|oauth|license|attribution|compatib|legacy|upstream|namespace|dependency|package|repository|homepage|bugs|quota|WebBridge|official plugin)\b/i;

function walk(path) {
  if (!existsSync(path)) return [];
  if (!path.endsWith('/') && !path.endsWith('package.json')) {
    // A file path is handled by the caller; this branch only keeps directory
    // traversal explicit and avoids following node_modules or dist output.
  }
  const entries = readdirSync(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = join(path, entry.name);
    if (entry.isDirectory()) files.push(...walk(abs));
    else if (SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) files.push(abs);
  }
  return files;
}

function filesForRoot(root) {
  const abs = join(ROOT, root);
  if (!existsSync(abs)) return [];
  return statSync(abs).isFile() ? [abs] : walk(abs);
}

export function scanBranding() {
  const findings = [];
  for (const root of ROOTS) {
    for (const file of filesForRoot(root)) {
      const text = readFileSync(file, 'utf8');
      const path = relative(ROOT, file).split('\\').join('/');
      for (const [index, line] of text.split('\n').entries()) {
        if (
          (path.startsWith('apps/kimi-code/src/') || path.startsWith('apps/vscode/src/')) &&
          /^\s*(?:\/\/|\/\*|\*|\*\/)/.test(line)
        ) {
          continue;
        }
        if (!LEGACY_PRODUCT_REFERENCES.test(line)) continue;
        LEGACY_PRODUCT_REFERENCES.lastIndex = 0;
        if (DOCUMENTED_EXCEPTION.test(line)) continue;
        DOCUMENTED_EXCEPTION.lastIndex = 0;
        findings.push({
          path,
          line: index + 1,
          text: line.trim().slice(0, 180),
        });
      }
    }
  }

  const webSourcePath = join(ROOT, WEB_SOURCE_ROOT);
  if (!existsSync(webSourcePath)) {
    findings.push({
      path: WEB_SOURCE_ROOT,
      line: 1,
      text: 'frontend source is external to this checkout; sync the source repository before releasing',
    });
  }

  const webBundlePath = join(ROOT, WEB_BUNDLE_ROOT);
  if (existsSync(webBundlePath)) {
    for (const file of walk(webBundlePath)) {
      const text = readFileSync(file, 'utf8');
      if (!LEGACY_PRODUCT_REFERENCES.test(text)) {
        LEGACY_PRODUCT_REFERENCES.lastIndex = 0;
        continue;
      }
      LEGACY_PRODUCT_REFERENCES.lastIndex = 0;
      findings.push({
        path: relative(ROOT, file).split('\\').join('/'),
        line: 1,
        text: 'generated web bundle contains Kimi/Moonshot product references; update source and resync dist-web',
      });
    }
  }

  const cliPackage = JSON.parse(readFileSync(join(ROOT, 'apps/kimi-code/package.json'), 'utf8'));
  const bins = cliPackage.bin ?? {};
  if (bins.spyderbyte === undefined) {
    findings.push({ path: 'apps/kimi-code/package.json', line: 1, text: 'missing spyderbyte executable alias' });
  }
  const desktopPackage = JSON.parse(readFileSync(join(ROOT, 'apps/vscode/package.json'), 'utf8'));
  if (desktopPackage.displayName !== 'SpiderByte') {
    findings.push({
      path: 'apps/vscode/package.json',
      line: 1,
      text: `desktop displayName is ${String(desktopPackage.displayName ?? '(unset)')}; migrate product metadata to SpiderByte`,
    });
  }
  return findings;
}

function main() {
  const findings = scanBranding();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ ok: findings.length === 0, findings }, null, 2)}\n`);
  } else if (findings.length === 0) {
    console.log('SpiderByte branding check passed.');
  } else {
    console.error(`SpiderByte branding check found ${String(findings.length)} finding(s):`);
    for (const finding of findings) {
      console.error(`  ${finding.path}:${String(finding.line)} — ${finding.text}`);
    }
    console.error('\nDocumented exceptions: provider names, OAuth/provider metadata, compatibility paths, package/env namespaces, WebBridge attribution, and legal attribution.');
  }
  if (findings.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
