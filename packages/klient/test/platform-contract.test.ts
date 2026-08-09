import { describe, expect, it } from 'vitest';

import {
  platformLifecycleEventSchema,
  providerConnectionSchema,
  runSchema,
} from '../src/index.js';
import {
  platformLifecycleEventSchema as protocolLifecycleEventSchema,
  providerConnectionSchema as protocolProviderConnectionSchema,
  runSchema as protocolRunSchema,
} from '@moonshot-ai/protocol';

const workspaceId = 'wd_kimi_0123456789ab';
const timestamp = '2026-08-08T12:00:00.000Z';

describe('klient platform contract exports', () => {
  it('re-export the protocol schemas without creating a second authority', () => {
    expect(runSchema).toBe(protocolRunSchema);
    expect(providerConnectionSchema).toBe(protocolProviderConnectionSchema);
    expect(platformLifecycleEventSchema).toBe(protocolLifecycleEventSchema);
  });

  it('validates the durable Run and replay event shapes through the public entry point', () => {
    const run = runSchema.parse({
      id: 'run_01',
      workspace_id: workspaceId,
      agent_session_id: 'session_01',
      request_id: 'request_01',
      status: 'queued',
      created_at: timestamp,
      updated_at: timestamp,
    });
    expect(run.id).toBe('run_01');

    const event = platformLifecycleEventSchema.parse({
      event_id: 'event_01',
      event_type: 'run.created',
      entity_type: 'run',
      entity_id: run.id,
      workspace_id: workspaceId,
      sequence: 1,
      occurred_at: timestamp,
      request_id: run.request_id,
      actor: 'user',
      state: run.status,
    });
    expect(event.entity_id).toBe(run.id);
  });

  it('keeps secret material outside the provider-connection projection', () => {
    expect(
      providerConnectionSchema.safeParse({
        id: 'connection_01',
        workspace_id: workspaceId,
        name: 'Local provider',
        provider: 'local',
        scope: 'workspace',
        state: 'active',
        secret_ref: 'secret_01',
        capabilities: ['chat'],
        created_at: timestamp,
        updated_at: timestamp,
        token: 'should-not-cross-the-boundary',
      }).success,
    ).toBe(false);
  });
});
