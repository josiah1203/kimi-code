import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createBom, parsePnpmLock } from './generate-sbom.mjs';

it('resolves package versions and dependency relationships from a pnpm lockfile', () => {
  const lock = parsePnpmLock(`
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      example:
        specifier: ^1.0.0
        version: 1.2.3
packages:
  'child@2.0.0':
    resolution: {integrity: sha512-YQ==}
  'example@1.2.3':
    resolution: {integrity: sha512-Yg==}
snapshots:
  'child@2.0.0': {}
  'example@1.2.3':
    dependencies:
      child: 2.0.0
`);

  assert.deepEqual([...lock.packages], [
    ['child@2.0.0', { name: 'child', version: '2.0.0', integrity: 'sha512-YQ==' }],
    ['example@1.2.3', { name: 'example', version: '1.2.3', integrity: 'sha512-Yg==' }],
  ]);
  assert.deepEqual([...lock.snapshots.get('example@1.2.3')], ['child@2.0.0']);
  assert.equal(lock.importers.get('.').get('example'), '1.2.3');
});

it('records an explicit reviewed license override when installed metadata is unavailable', () => {
  const lockText = `
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      example-native:
        specifier: 1.0.0
        version: 1.0.0
packages:
  'example-native@1.0.0':
    resolution: {integrity: sha512-YQ==}
snapshots:
  'example-native@1.0.0': {}
`;
  const manifests = new Map([['.', { name: '@example/root', version: '1.0.0', private: true, license: 'MIT' }]]);
  const bom = createBom(lockText, manifests, new Map(), [
    { pattern: 'example-*', license: 'MIT', evidence: 'Source package license' },
  ]);
  const component = bom.components.find((item) => item.name === 'example-native');

  assert.deepEqual(component.licenses, [{ expression: 'MIT' }]);
  assert.ok(component.properties.some((item) => item.name === 'org.spiderbyte.license.source' && item.value === 'reviewed-override'));
});
