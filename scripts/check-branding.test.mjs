/**
 * Branding-gate contract scenarios.
 *
 * Exercises the exported text scanner with no filesystem or network stubs.
 * Run with `node --test scripts/check-branding.test.mjs`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scanBrandingText } from './check-branding.mjs';

describe('SpiderByte branding text gate', () => {
  it('reports the retired product name when active copy uses Kimi Code', () => {
    const findings = scanBrandingText('README.md', 'Welcome to Kimi Code.');

    assert.deepEqual(findings.map((finding) => finding.pattern), ['kimi-code']);
  });

  it('reports the retired executable when a command is constructed as kimi', () => {
    const findings = scanBrandingText('apps/cli/test.ts', "const program = new Command('kimi');");

    assert.deepEqual(findings.map((finding) => finding.pattern), ['kimi-cli-constructor']);
  });

  it('reports the retired executable when argv launches kimi', () => {
    const findings = scanBrandingText(
      'apps/cli/test.ts',
      "program.parseAsync(['node', 'kimi', 'provider']);",
    );

    assert.deepEqual(findings.map((finding) => finding.pattern), ['kimi-cli-argv']);
  });

  it('accepts Kimi and Moonshot when they identify an external provider', () => {
    const findings = scanBrandingText(
      'packages/kosong/src/providers/kimi.ts',
      [
        'export class KimiChatProvider {}',
        "export const KIMI_DEFAULT_BASE_URL = 'https://api.moonshot.ai/v1';",
        "registerProviderDefinition({ id: 'kimi' });",
      ].join('\n'),
    );

    assert.deepEqual(findings, []);
  });
});
