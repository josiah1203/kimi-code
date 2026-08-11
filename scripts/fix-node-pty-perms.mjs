#!/usr/bin/env node
/**
 * Restore the executable bit on node-pty's `spawn-helper` prebuilt binaries.
 *
 * Why: on macOS/Linux node-pty launches the shell through a tiny `spawn-helper`
 * executable shipped under `prebuilds/<platform-arch>/`. pnpm's content-
 * addressable store does not preserve the +x mode on these non-bin prebuild
 * assets, so after `pnpm install` the helper lands as 0644 and any PTY spawn
 * fails with "posix_spawnp failed". npm/yarn (and the published tarball) keep
 * the bit, so this is a pnpm-dev-only fixup.
 *
 * Idempotent and never fails the install: any error is logged and ignored.
 */
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

function nodePtyRoots() {
  const roots = [];
  const require = createRequire(import.meta.url);
  try {
    // Resolve from the repository root when a workspace hoist is available.
    const entry = require.resolve('node-pty', { paths: [process.cwd()] });
    roots.push(dirname(dirname(entry)));
  } catch {
    // pnpm may not expose a root-level symlink during lifecycle ordering.
  }

  // During pnpm's root postinstall, dependency lifecycle scripts have not yet
  // created the workspace links. Locate the package in pnpm's virtual store so
  // the executable-bit fix still runs on a clean install.
  const virtualStore = resolve(import.meta.dirname, '..', 'node_modules/.pnpm');
  if (existsSync(virtualStore)) {
    for (const entry of readdirSync(virtualStore)) {
      if (!entry.startsWith('node-pty@')) continue;
      const root = join(virtualStore, entry, 'node_modules/node-pty');
      if (existsSync(root)) roots.push(root);
    }
  }

  return [...new Set(roots)];
}

try {
  let fixed = 0;
  for (const root of nodePtyRoots()) {
    const prebuilds = join(root, 'prebuilds');
    if (!existsSync(prebuilds)) continue;
    for (const arch of readdirSync(prebuilds)) {
      const helper = join(prebuilds, arch, 'spawn-helper');
      if (!existsSync(helper)) continue;
      const mode = statSync(helper).mode;
      if ((mode & 0o111) === 0o111) continue; // already executable
      chmodSync(helper, 0o755);
      fixed++;
    }
  }
  if (fixed > 0) console.log(`[fix-node-pty-perms] made ${fixed} spawn-helper binary(ies) executable`);
} catch (err) {
  console.warn('[fix-node-pty-perms] skipped:', err instanceof Error ? err.message : String(err));
}
process.exit(0);
