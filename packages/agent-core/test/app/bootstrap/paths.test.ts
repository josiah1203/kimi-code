import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureSpiderByteHome, resolveConfigPath, resolveSpiderByteHome } from '#/app/bootstrap/bootstrap';

describe('bootstrap path helpers', () => {
  describe('resolveSpiderByteHome', () => {
    it('uses explicit homeDir when provided', () => {
      expect(resolveSpiderByteHome('/tmp/spiderbyte')).toBe('/tmp/spiderbyte');
    });

    it('falls back to SPIDERBYTE_HOME env', () => {
      const prev = process.env['SPIDERBYTE_HOME'];
      process.env['SPIDERBYTE_HOME'] = '/env/spiderbyte';
      try {
        expect(resolveSpiderByteHome()).toBe('/env/spiderbyte');
      } finally {
        if (prev === undefined) delete process.env['SPIDERBYTE_HOME'];
        else process.env['SPIDERBYTE_HOME'] = prev;
      }
    });
  });

  describe('resolveConfigPath', () => {
    it('uses explicit configPath when provided', () => {
      expect(resolveConfigPath({ configPath: '/x/config.toml' })).toBe('/x/config.toml');
    });

    it('joins homeDir with config.toml', () => {
      expect(resolveConfigPath({ homeDir: '/tmp/spiderbyte' })).toBe('/tmp/spiderbyte/config.toml');
    });
  });

  describe('ensureSpiderByteHome', () => {
    let dir: string | undefined;
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('creates the directory with 0700 permissions', () => {
      dir = join(mkdtempSync(join(tmpdir(), 'spiderbyte-home-')), 'nested');
      ensureSpiderByteHome(dir);
      expect(existsSync(dir)).toBe(true);
    });
  });
});
