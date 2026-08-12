import { describe, expect, it } from 'vitest';

import { InMemoryAuditWriter, InMemoryCommercialStore, MonotonicIdGenerator } from '../../adapters/src/index';
import { CommercialEntitlementService } from '@spiderbyte/commercial-billing';
import { CommercialMcpToolRegistry } from '@spiderbyte/commercial-mcp';
import { principalSchema } from '@spiderbyte/commercial-domain';

const now = '2026-08-11T12:00:00.000Z';
const actor = { kind: 'system' as const, id: 'mcp-test' };

async function createRegistry() {
  const store = new InMemoryCommercialStore();
  const audit = new InMemoryAuditWriter();
  const clock = { now: () => now };
  const ids = new MonotonicIdGenerator();
  const entitlements = new CommercialEntitlementService({ store, clock, ids, audit });
  const plans = await entitlements.seedDefaultPlans('acct_01', actor);
  await entitlements.changeSubscription({ account_id: 'acct_01', organization_id: 'org_01', plan_id: plans[0]!.id, actor, request_id: 'mcp-subscription' });
  return new CommercialMcpToolRegistry({ authorize: async (context, action) => {
    if (!context.principal.scopes.includes(action)) throw new Error('denied');
  } }, entitlements);
}

const context = {
  principal: principalSchema.parse({ subject_id: 'usr_mcp', account_id: 'acct_01', user_id: 'usr_mcp', organization_ids: ['org_01'], scopes: ['usage.read', 'compute.submit'], auth_method: 'session', issued_at: now, expires_at: '2026-08-12T12:00:00.000Z' }),
  organization_id: 'org_01', request_id: 'mcp-request-1',
};

describe('commercial MCP capability gate', () => {
  it('only lists and invokes tools allowed by authorization and entitlements', async () => {
    const registry = await createRegistry();
    registry.register({ name: 'usage_summary', description: 'Read hosted usage', action: 'usage.read', invoke: async () => ({ status: 'ok' }) });
    registry.register({ name: 'compute_submit', description: 'Submit hosted compute', action: 'compute.submit', entitlement: 'hosted_compute', invoke: async () => ({ status: 'submitted' }) });
    expect((await registry.listAvailable(context)).map((tool) => tool.name)).toEqual(['usage_summary']);
    await expect(registry.call('compute_submit', context, {})).rejects.toMatchObject({ code: 'commercial.billing.entitlement_not_included' });
    await expect(registry.call('usage_summary', context, {})).resolves.toEqual({ status: 'ok' });
  });
});
