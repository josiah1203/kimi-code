#!/usr/bin/env node
/** Validate local Markdown/HTML documentation links and anchors. */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DOCS_ROOT = join(ROOT, 'docs');
const SKIPPED_DIRECTORIES = new Set(['.vitepress', 'node_modules']);

function markdownFiles(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) markdownFiles(path, output);
    else if (entry.isFile() && extname(entry.name) === '.md' && entry.name !== 'AGENTS.md') output.push(path);
  }
  return output;
}

function decode(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`invalid percent encoding in ${label}: ${value}`);
  }
}

function slugify(value) {
  return value
    .replaceAll(/<[^>]*>/gu, '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replaceAll(/\s+/gu, '-')
    .replaceAll(/-+/gu, '-');
}

function anchorsFor(text) {
  const anchors = new Set();
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const match of line.matchAll(/\bid=["']([^"']+)["']/gu)) anchors.add(match[1].toLowerCase());
    const heading = /^(?: {0,3})#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line);
    if (heading === null) continue;
    const base = slugify(heading[1]);
    if (base.length === 0) continue;
    let anchor = base;
    let suffix = 1;
    while (anchors.has(anchor)) anchor = `${base}-${suffix++}`;
    anchors.add(anchor);
  }
  return anchors;
}

function splitTarget(target, source) {
  const queryStart = target.indexOf('?');
  const withoutQuery = queryStart === -1 ? target : target.slice(0, queryStart);
  const hashStart = withoutQuery.indexOf('#');
  const pathPart = hashStart === -1 ? withoutQuery : withoutQuery.slice(0, hashStart);
  const anchor = hashStart === -1 ? undefined : decode(withoutQuery.slice(hashStart + 1), target);
  return { pathPart: decode(pathPart, target), anchor, source };
}

function candidatesFor(path) {
  const normalized = path.replaceAll('\\', '/');
  const candidates = [normalized];
  if (extname(normalized) === '') {
    candidates.push(`${normalized}.md`, join(normalized, 'index.md'));
  } else if (normalized.endsWith('.html')) {
    candidates.push(`${normalized.slice(0, -5)}.md`);
  }
  return candidates;
}

function resolveTarget(source, targetPath) {
  let base;
  if (targetPath.startsWith(`${ROOT}/`)) base = targetPath;
  else if (targetPath.startsWith('/')) base = join(DOCS_ROOT, targetPath.slice(1));
  else base = resolve(dirname(source), targetPath);
  return candidatesFor(base).find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function isExternal(target) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(target);
}

function linksIn(text) {
  const links = [];
  let inFence = false;
  for (const [lineNumber, line] of text.split('\n').entries()) {
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const match of line.matchAll(/(!?)\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/gu)) {
      if (match[1] === '') links.push({ target: match[2], line: lineNumber + 1 });
    }
    for (const match of line.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gu)) {
      links.push({ target: match[1], line: lineNumber + 1 });
    }
  }
  return links;
}

function checkDocs() {
  const files = markdownFiles(DOCS_ROOT).toSorted((left, right) => left.localeCompare(right));
  const anchors = new Map(files.map((file) => [file, anchorsFor(readFileSync(file, 'utf8'))]));
  const findings = [];
  let localLinkCount = 0;

  for (const file of files) {
    for (const link of linksIn(readFileSync(file, 'utf8'))) {
      if (isExternal(link.target)) continue;
      localLinkCount++;
      const target = splitTarget(link.target, file);
      const resolved = resolveTarget(file, target.pathPart || file);
      const label = `${relative(ROOT, file)}:${String(link.line)} -> ${link.target}`;
      if (resolved === undefined) {
        findings.push(`${label}: target does not exist`);
        continue;
      }
      if (target.anchor !== undefined && extname(resolved) === '.md') {
        const normalizedAnchor = target.anchor.toLowerCase();
        if (!anchors.get(resolved)?.has(normalizedAnchor)) findings.push(`${label}: anchor does not exist`);
      }
    }
  }

  return { files: files.length, localLinkCount, findings };
}

function main() {
  const result = checkDocs();
  if (result.findings.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`Documentation link check passed for ${String(result.files)} Markdown files and ${String(result.localLinkCount)} local links.`);
    return;
  }
  // eslint-disable-next-line no-console
  console.error(`Documentation link check found ${String(result.findings.length)} issue(s):`);
  for (const finding of result.findings) {
    // eslint-disable-next-line no-console
    console.error(`  - ${finding}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] === import.meta.filename) main();

export { checkDocs };
