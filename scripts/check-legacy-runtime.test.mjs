/** Contract scenarios for the supported-runtime gate. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeSdkStubGraph, scanLegacyRuntimeText } from './check-legacy-runtime.mjs';

describe('SpiderByte legacy-runtime source gate', () => {
  it('reports an active import from a quarantined compatibility package', () => {
    const findings = scanLegacyRuntimeText(
      'apps/cli/src/main.ts',
      "import { LegacyCore } from '@spiderbyte/legacy-agent-core';",
    );

    assert.deepEqual(findings.map((finding) => finding.pattern), ['legacy-import']);
  });

  it('reports the retired runtime flag in active code', () => {
    const findings = scanLegacyRuntimeText(
      'apps/cli/src/main.ts',
      'if (SPIDERBYTE_LEGACY_FLAG) startLegacy();',
    );

    assert.deepEqual(findings.map((finding) => finding.pattern), ['legacy-identifier']);
  });
});

describe('SpiderByte SDK stub reachability gate', () => {
  it('reports a public base method that reaches a stub without a canonical override', () => {
    const findings = analyzeSdkStubGraph(
      `
        abstract class SDKRpcClientBase {
          protected abstract getRpc(): Promise<unknown>;
          async advertised() { return this.getRpc(); }
        }
      `,
      'class SpiderByteSdkClient extends SDKRpcClientBase {}',
    );

    assert.deepEqual(findings.map((finding) => finding.pattern), ['reachable-sdk-stub']);
  });

  it('accepts the capability when the canonical client overrides it', () => {
    const findings = analyzeSdkStubGraph(
      `
        abstract class SDKRpcClientBase {
          protected abstract getRpc(): Promise<unknown>;
          async advertised() { return this.getRpc(); }
        }
      `,
      `
        class SpiderByteSdkClient extends SDKRpcClientBase {
          async advertised() { return 'implemented'; }
        }
      `,
    );

    assert.deepEqual(findings, []);
  });
});
