import assert from 'node:assert/strict';
import { it } from 'node:test';
import { validateLicensePolicy } from './check-license-policy.mjs';

const future = new Date('2026-08-10T00:00:00Z');

it('rejects a dependency whose license is neither allowed nor explicitly reviewed', () => {
  const bom = { components: [{ 'bom-ref': 'bad@1.0.0', licenses: [{ expression: 'UNKNOWN' }] }] };
  const policy = { schema_version: 1, owner: 'maintainers', review_by: '2027-01-01', allowed_expressions: [], reviewed_exceptions: [] };

  assert.deepEqual(validateLicensePolicy(bom, policy, future), ['bad@1.0.0: license is not allowed: UNKNOWN']);
});

it('accepts a current, owned exception for one dependency family', () => {
  const bom = { components: [{ 'bom-ref': 'tool-native@1.0.0', licenses: [{ expression: 'LicenseRef-Tool' }] }] };
  const policy = {
    schema_version: 1,
    owner: 'maintainers',
    review_by: '2027-01-01',
    allowed_expressions: [],
    reviewed_exceptions: [{ bom_ref_prefix: 'tool-native@', license: 'LicenseRef-Tool', disposition: 'build only', owner: 'release', review_by: '2027-01-01' }],
  };

  assert.deepEqual(validateLicensePolicy(bom, policy, future), []);
});
