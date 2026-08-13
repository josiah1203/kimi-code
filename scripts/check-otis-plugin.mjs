#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const pluginRoot = join(root, 'plugins', 'otis');
const manifestPath = join(pluginRoot, '.codex-plugin', 'plugin.json');
const mcpPath = join(pluginRoot, '.mcp.json');

const failures = [];

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function requireValue(value, path) {
  if (value === undefined || value === null || value === '') failures.push(`${path}: required`);
}

const manifest = await readJson(manifestPath);
const mcp = await readJson(mcpPath);

if (manifest !== undefined) {
  for (const key of ['name', 'version', 'description', 'author', 'homepage', 'repository', 'skills', 'mcpServers', 'interface']) {
    requireValue(manifest[key], `plugin.json.${key}`);
  }
  if (manifest.name !== 'otis') failures.push('plugin.json.name: expected otis');
  if (manifest.skills !== './skills/') failures.push('plugin.json.skills: expected ./skills/');
  if (manifest.mcpServers !== './.mcp.json') failures.push('plugin.json.mcpServers: expected ./.mcp.json');
  if (manifest.interface?.displayName !== 'Otis') failures.push('plugin.json.interface.displayName: expected Otis');
}

if (mcp !== undefined) {
  const servers = mcp.mcpServers;
  if (servers === undefined || typeof servers !== 'object' || Array.isArray(servers)) {
    failures.push('.mcp.json.mcpServers: expected an object');
  } else {
    const local = servers['spiderbyte-local'];
    if (local?.command !== 'spyderbyte') failures.push('.mcp.json.spiderbyte-local.command: expected spyderbyte');
    if (JSON.stringify(local?.args) !== JSON.stringify(['mcp', '--profile', 'curated'])) failures.push('.mcp.json.spiderbyte-local.args: expected curated MCP profile');
    if (/(sk-[A-Za-z0-9]|Bearer\s+[^<$`\s]+|api[_-]?key\s*[:=])/i.test(JSON.stringify(mcp))) {
      failures.push('.mcp.json: possible secret or bearer credential');
    }
  }
}

const skillsRoot = join(pluginRoot, 'skills');
let skillEntries = [];
try {
  skillEntries = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
} catch (error) {
  failures.push(`skills/: ${error instanceof Error ? error.message : String(error)}`);
}

if (skillEntries.length === 0) failures.push('skills/: at least one skill is required');
for (const skill of skillEntries) {
  const path = join(skillsRoot, skill, 'SKILL.md');
  let content;
  try {
    await stat(path);
    content = await readFile(path, 'utf8');
  } catch (error) {
    failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  if (!content.startsWith('---\n')) failures.push(`${path}: missing YAML frontmatter`);
  const requiredSections = [
    ['activation', /^## Activation(?: conditions)?\s*$/m],
    ['tools', /^## Required (?:MCP )?tools\s*$/m],
    ['workflow', /^## Workflow\s*$/m],
    ['confirmation', /^## Confirmation(?: and failure handling)?\s*$/m],
    ['failure', /^## (?:Failure handling|Confirmation and failure handling)\s*$/m],
    ['expected output', /^## Expected output\s*$/m],
    ['examples', /^## Examples?\s*$/m],
    ['privacy', /^## Privacy(?: and security)?\s*$/m],
  ];
  for (const [label, pattern] of requiredSections) {
    if (!pattern.test(content)) failures.push(`${path}: missing ${label} section`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`Otis plugin check failed (${failures.length} finding${failures.length === 1 ? '' : 's'}):\n`);
  process.stderr.write(failures.map((failure) => `- ${failure}`).join('\n') + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`Otis plugin check passed: ${skillEntries.length} skills, local stdio MCP configuration, no embedded credentials.\n`);
}
