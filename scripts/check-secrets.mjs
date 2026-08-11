#!/usr/bin/env node
/** Scan tracked source, generated output, CI files, and package tarballs for credential material. */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['', '.cjs', '.css', '.graphql', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.mts', '.sh', '.sql', '.svg', '.toml', '.ts', '.tsx', '.txt', '.yaml', '.yml']);
const PATTERNS = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ['OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
];

function scanText(text, label) {
  const findings = [];
  for (const [kind, pattern] of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split('\n').length;
      findings.push(`${label}:${String(line)}: possible ${kind}`);
    }
  }
  return findings;
}

function walk(path, output = []) {
  if (!existsSync(path)) return output;
  const stat = statSync(path);
  if (stat.isFile()) {
    output.push(path);
    return output;
  }
  for (const entry of readdirSync(path)) walk(join(path, entry), output);
  return output;
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString().split('\0').filter(Boolean).map((path) => join(ROOT, path));
}

function generatedFiles() {
  const roots = ['dist', 'build', 'out', '.vitepress/dist'];
  const files = [];
  for (const parent of ['.', 'apps', 'packages', 'docs']) {
    const base = join(ROOT, parent);
    if (!existsSync(base)) continue;
    const projects = parent === '.' ? [base] : readdirSync(base, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => join(base, item.name));
    for (const project of projects) for (const output of roots) walk(join(project, output), files);
  }
  return files;
}

function main() {
  const findings = [];
  const files = [...new Set([...trackedFiles(), ...generatedFiles()])];
  for (const path of files) {
    if (!existsSync(path) || statSync(path).size > MAX_TEXT_BYTES || !TEXT_EXTENSIONS.has(extname(path))) continue;
    const bytes = readFileSync(path);
    if (bytes.includes(0)) continue;
    findings.push(...scanText(bytes.toString('utf8'), relative(ROOT, path)));
  }
  const tarballs = files.filter((path) => path.endsWith('.tgz') && statSync(path).size <= 100 * 1024 * 1024);
  for (const path of tarballs) {
    const contents = execFileSync('tar', ['-xOzf', path], { maxBuffer: 100 * 1024 * 1024 }).toString('utf8');
    findings.push(...scanText(contents, `${relative(ROOT, path)} (contents)`));
  }
  if (findings.length > 0) {
    console.error(`Secret scan found ${String(findings.length)} issue(s):`);
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exitCode = 1;
  } else console.log(`Secret scan passed across ${String(files.length)} source/generated files and ${String(tarballs.length)} tarballs.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { scanText };
