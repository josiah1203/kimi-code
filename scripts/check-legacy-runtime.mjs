#!/usr/bin/env node
/**
 * Supported-runtime gate for the SpiderByte Open Core distribution.
 *
 * Compatibility packages may exist under compat/, but active workspace code
 * must not import them or expose a public SDK path that reaches a coded stub.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const ACTIVE_ROOTS = ['apps', 'packages', 'scripts'];
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const IGNORED_DIRECTORIES = new Set(['.git', '.tmp', 'compat', 'coverage', 'dist', 'node_modules']);
const SELF_PATHS = new Set([
  'scripts/check-legacy-runtime.mjs',
  'scripts/check-legacy-runtime.test.mjs',
]);
const LEGACY_MODULE = /(?:^@spiderbyte\/legacy-|(?:^|\/)compat\/legacy-)/;
const FORBIDDEN_IDENTIFIERS = new Set(['SPIDERBYTE_LEGACY_FLAG', 'engineAccessor']);
const FORBIDDEN_TEXT = new Set(['experimental-v2', 'executor-unavailable']);
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function rel(path) {
  return relative(ROOT, path).split('\\').join('/');
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) files.push(...walk(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function sourceFile(path, text) {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX
    : path.endsWith('.jsx') ? ts.ScriptKind.JSX
      : path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
}

function lineOf(file, node) {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

function moduleSpecifier(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
      ? node.moduleSpecifier.text
      : undefined;
  }
  if (!ts.isCallExpression(node) || node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) {
    return undefined;
  }
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return node.arguments[0].text;
  if (ts.isIdentifier(node.expression) && node.expression.text === 'require') return node.arguments[0].text;
  return undefined;
}

function scanLegacyRuntimeText(path, text) {
  const file = sourceFile(path, text);
  const findings = [];
  function visit(node) {
    const specifier = moduleSpecifier(node);
    if (specifier !== undefined && LEGACY_MODULE.test(specifier)) {
      findings.push({ path, line: lineOf(file, node), pattern: 'legacy-import', text: specifier });
    }
    if (ts.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.has(node.text)) {
      findings.push({ path, line: lineOf(file, node), pattern: 'legacy-identifier', text: node.text });
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && FORBIDDEN_TEXT.has(node.text)) {
      findings.push({ path, line: lineOf(file, node), pattern: 'legacy-runtime-token', text: node.text });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return findings;
}

function classMethods(path, text, className) {
  const file = sourceFile(path, text);
  let target;
  function visit(node) {
    if (ts.isClassDeclaration(node) && node.name?.text === className) target = node;
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (target === undefined) throw new Error(`${className} is missing from ${path}`);
  const methods = new Map();
  for (const member of target.members) {
    if (!ts.isMethodDeclaration(member) || member.body === undefined) continue;
    const name = member.name.getText(file);
    const modifiers = new Set(member.modifiers?.map((modifier) => modifier.kind) ?? []);
    methods.set(name, {
      body: member.body.getText(file),
      line: lineOf(file, member),
      public: !modifiers.has(ts.SyntaxKind.PrivateKeyword) && !modifiers.has(ts.SyntaxKind.ProtectedKeyword),
    });
  }
  return methods;
}

function analyzeSdkStubGraph(baseText, canonicalText) {
  const basePath = 'packages/sdk/src/rpc.ts';
  const canonicalPath = 'packages/sdk/src/spiderbyte-sdk-client.ts';
  const base = classMethods(basePath, baseText, 'SDKRpcClientBase');
  const canonical = classMethods(canonicalPath, canonicalText, 'SpiderByteSdkClient');
  const unsafe = new Set();
  for (const [name, method] of base) {
    if (/this\.getRpc\s*\(/.test(method.body) || /ErrorCodes\.NOT_IMPLEMENTED|executor-unavailable/.test(method.body)) {
      unsafe.add(name);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, method] of base) {
      if (unsafe.has(name)) continue;
      if ([...unsafe].some((callee) => new RegExp(`this\\.${callee}\\s*\\(`).test(method.body))) {
        unsafe.add(name);
        changed = true;
      }
    }
  }

  const findings = [];
  for (const name of unsafe) {
    const method = base.get(name);
    if (method.public && !canonical.has(name)) {
      findings.push({
        path: basePath,
        line: method.line,
        pattern: 'reachable-sdk-stub',
        text: `${name} is not implemented by SpiderByteSdkClient`,
      });
    }
  }
  for (const [name, method] of canonical) {
    if (method.public && /ErrorCodes\.NOT_IMPLEMENTED|executor-unavailable/.test(method.body)) {
      findings.push({
        path: canonicalPath,
        line: method.line,
        pattern: 'canonical-sdk-stub',
        text: `${name} unconditionally reports an unsupported capability`,
      });
    }
  }
  return findings;
}

function scanManifest(path, text) {
  const manifest = JSON.parse(text);
  const findings = [];
  for (const field of DEPENDENCY_FIELDS) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (name.startsWith('@spiderbyte/legacy-')) {
        findings.push({ path, line: 1, pattern: 'legacy-dependency', text: `${field}.${name}` });
      }
    }
  }
  return findings;
}

function scanLegacyRuntime() {
  const findings = [];
  for (const root of ACTIVE_ROOTS) {
    for (const absolute of walk(join(ROOT, root))) {
      const path = rel(absolute);
      if (SELF_PATHS.has(path)) continue;
      if (path.endsWith('/experimental-v2.ts') || path.endsWith('/experimental-v2.mts')) {
        findings.push({ path, line: 1, pattern: 'legacy-runtime-file', text: 'experimental-v2 entrypoint' });
      }
      if (path.endsWith('/package.json')) {
        findings.push(...scanManifest(path, readFileSync(absolute, 'utf8')));
      } else if (SOURCE_EXTENSIONS.has(extname(path))) {
        findings.push(...scanLegacyRuntimeText(path, readFileSync(absolute, 'utf8')));
      }
    }
  }
  findings.push(...analyzeSdkStubGraph(
    readFileSync(join(ROOT, 'packages/sdk/src/rpc.ts'), 'utf8'),
    readFileSync(join(ROOT, 'packages/sdk/src/spiderbyte-sdk-client.ts'), 'utf8'),
  ));
  return findings;
}

function main() {
  const findings = scanLegacyRuntime();
  const output = { ok: findings.length === 0, findings };
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else if (output.ok) {
    console.log('SpiderByte legacy-runtime check passed.');
  } else {
    console.error(`SpiderByte legacy-runtime check found ${String(findings.length)} finding(s):`);
    for (const finding of findings) {
      console.error(`  ${finding.path}:${String(finding.line)} [${finding.pattern}] — ${finding.text}`);
    }
  }
  if (!output.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { analyzeSdkStubGraph, scanLegacyRuntime, scanLegacyRuntimeText };
