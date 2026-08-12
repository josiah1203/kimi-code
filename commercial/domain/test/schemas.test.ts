import { describe, expect, it } from 'vitest';

import {
  assertSafeMetadata,
  capabilityStatusSchema,
  computeReservationSchema,
  enterpriseConfigurationSchema,
  hostedArtifactSchema,
  prefixedIdentifier,
} from '@spiderbyte/commercial-domain';

describe('commercial domain contracts', () => {
  it('requires stable prefixed identifiers and valid capability states', () => {
    expect(prefixedIdentifier('org_').parse('org_01')).toBe('org_01');
    expect(() => prefixedIdentifier('org_').parse('workspace_01')).toThrow();
    expect(capabilityStatusSchema.parse({
      capability: 'sso',
      availability: 'not_configured',
      reason: 'provider credentials are not configured',
      checked_at: '2026-08-11T12:00:00.000Z',
    }).availability).toBe('not_configured');
  });

  it('models explicit unavailable compute and immutable artifact ownership', () => {
    const reservation = computeReservationSchema.parse({
      id: 'reserve_01',
      account_id: 'acct_01',
      organization_id: 'org_01',
      workspace_id: 'cws_01',
      provider_id: 'compute_01',
      region_id: 'region_01',
      job_class_id: 'jobclass_01',
      state: 'unavailable',
      requested_at: '2026-08-11T12:00:00.000Z',
      version: 1,
      created_at: '2026-08-11T12:00:00.000Z',
      updated_at: '2026-08-11T12:00:00.000Z',
      created_by: { kind: 'system', id: 'test-system' },
      updated_by: { kind: 'system', id: 'test-system' },
    });
    expect(reservation.state).toBe('unavailable');

    const artifact = hostedArtifactSchema.parse({
      id: 'hartifact_01',
      account_id: 'acct_01',
      organization_id: 'org_01',
      workspace_id: 'cws_01',
      name: 'result.json',
      content_address: `sha256:${'a'.repeat(64)}`,
      object_ref: 'object://test/result',
      media_type: 'application/json',
      size_bytes: 12,
      state: 'available',
      legal_hold_ids: [],
      version: 1,
      created_at: '2026-08-11T12:00:00.000Z',
      updated_at: '2026-08-11T12:00:00.000Z',
      created_by: { kind: 'system', id: 'test-system' },
      updated_by: { kind: 'system', id: 'test-system' },
    });
    expect(artifact.organization_id).toBe('org_01');
  });

  it('rejects sensitive metadata while allowing secret references', () => {
    expect(() => { assertSafeMetadata({ access_token: 'hidden' }); }).toThrow();
    expect(() => { assertSafeMetadata({ provider_secret_ref: 'secret_provider_01' }); }).not.toThrow();
  });

  it('accepts enterprise configuration as a stateful contract', () => {
    const configuration = enterpriseConfigurationSchema.parse({
      id: 'enterprise_01',
      account_id: 'acct_01',
      organization_id: 'org_01',
      verified_domain_ids: [],
      group_role_mappings: {},
      enforced_sso: false,
      mfa_required: false,
      ip_allowlist: [],
      api_restrictions: [],
      deployment_mode: 'shared',
      release_channel: 'stable',
      state: 'draft',
      version: 1,
      created_at: '2026-08-11T12:00:00.000Z',
      updated_at: '2026-08-11T12:00:00.000Z',
      created_by: { kind: 'system', id: 'test-system' },
      updated_by: { kind: 'system', id: 'test-system' },
    });
    expect(configuration.state).toBe('draft');
  });
});
