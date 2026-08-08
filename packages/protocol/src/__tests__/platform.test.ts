import { describe, expect, it } from 'vitest';

import {
  agentSessionSchema,
  artifactSchema,
  executionTargetSchema,
  platformCommandAcceptedSchema,
  platformLifecycleEventSchema,
  platformWorkspaceSchema,
  policyDecisionSchema,
  providerConnectionSchema,
  resourceSchema,
  runSchema,
  usageRecordSchema,
} from '../platform';
import { workspaceSchema } from '../workspace';

const timestamps = {
  created_at: '2026-08-08T12:00:00.000Z',
  updated_at: '2026-08-08T12:01:00.000Z',
};

const workspaceId = 'wd_kimi_0123456789ab';

describe('platform contracts', () => {
  it('keeps the legacy workspace projection compatible without platform fields', () => {
    const workspace = workspaceSchema.parse({
      id: workspaceId,
      root: '/tmp/kimi',
      name: 'kimi',
      created_at: timestamps.created_at,
      last_opened_at: timestamps.updated_at,
      session_count: 0,
    });
    expect(workspace.state).toBeUndefined();
    expect(workspace.archived_at).toBeUndefined();
  });

  it('validates the enhanced workspace and AgentSession projections', () => {
    const workspace = platformWorkspaceSchema.parse({
      id: workspaceId,
      root: '/tmp/kimi',
      name: 'kimi',
      state: 'active',
      ...timestamps,
      last_opened_at: timestamps.updated_at,
      session_count: 1,
    });
    expect(workspace.state).toBe('active');

    const session = agentSessionSchema.parse({
      id: 'session_01',
      workspace_id: workspaceId,
      title: 'Platform slice',
      state: 'active',
      cwd: '/tmp/kimi',
      ...timestamps,
      active_run_id: 'run_01',
      run_count: 1,
    });
    expect(session.active_run_id).toBe('run_01');
  });

  it('validates a Run with plan, resource inputs, and artifact outputs', () => {
    const run = runSchema.parse({
      id: 'run_01',
      workspace_id: workspaceId,
      agent_session_id: 'session_01',
      request_id: 'request_01',
      status: 'running',
      ...timestamps,
      plan: [{ id: 'step_01', title: 'Inspect repository', status: 'active' }],
      input_resources: [{ id: 'dataset_01', type: 'dataset', version: 1 }],
      output_artifacts: [{ id: 'artifact_01', version: 1 }],
      policy_decision_ids: ['policy_01'],
      execution_target_id: 'target_local',
    });
    expect(run.status).toBe('running');
  });

  it('validates resource, artifact, policy, usage, and execution contracts', () => {
    expect(
      resourceSchema.parse({
        id: 'dataset_01',
        workspace_id: workspaceId,
        type: 'dataset',
        name: 'training data',
        state: 'ready',
        version: 1,
        ...timestamps,
        artifact_ids: ['artifact_01'],
      }).type,
    ).toBe('dataset');

    expect(
      artifactSchema.parse({
        id: 'artifact_01',
        workspace_id: workspaceId,
        run_id: 'run_01',
        name: 'metrics.json',
        kind: 'metrics',
        version: 1,
        content_ref: 'sha256:metrics',
        created_at: timestamps.created_at,
      }).content_ref,
    ).toBe('sha256:metrics');

    expect(
      policyDecisionSchema.parse({
        id: 'policy_01',
        workspace_id: workspaceId,
        run_id: 'run_01',
        capability: 'filesystem',
        action: 'read:/tmp/kimi',
        state: 'approved',
        outcome: 'allow',
        reason: 'Workspace policy allows the read.',
        requested_by: 'agent',
        decided_by: 'user',
        requested_at: timestamps.created_at,
        evaluated_at: timestamps.updated_at,
        resolved_at: timestamps.updated_at,
      }).outcome,
    ).toBe('allow');

    expect(
      usageRecordSchema.parse({
        id: 'usage_01',
        workspace_id: workspaceId,
        run_id: 'run_01',
        meter: 'intelligence',
        unit: 'intelligence_percent',
        amount: 1,
        execution_target_id: 'target_local',
        recorded_at: timestamps.updated_at,
      }).meter,
    ).toBe('intelligence');

    expect(
      executionTargetSchema.parse({
        id: 'target_local',
        workspace_id: workspaceId,
        name: 'Local machine',
        type: 'local',
        state: 'ready',
        locality: 'local',
        capabilities: ['filesystem', 'shell'],
        ...timestamps,
      }).locality,
    ).toBe('local');
  });

  it('rejects raw provider secrets and raw token counters from public contracts', () => {
    const providerConnection = providerConnectionSchema.safeParse({
      id: 'connection_01',
      workspace_id: workspaceId,
      name: 'OpenAI BYOK',
      provider: 'openai',
      scope: 'workspace',
      state: 'active',
      secret_ref: 'secret_01',
      capabilities: ['chat'],
      ...timestamps,
      api_key: 'sk-secret',
    });
    expect(providerConnection.success).toBe(false);

    const usageRecord = usageRecordSchema.safeParse({
      id: 'usage_01',
      workspace_id: workspaceId,
      run_id: 'run_01',
      meter: 'intelligence',
      unit: 'intelligence_percent',
      amount: 1,
      recorded_at: timestamps.updated_at,
      token_count: 42,
    });
    expect(usageRecord.success).toBe(false);
  });

  it('provides replayable lifecycle events and durable command acknowledgements', () => {
    const event = platformLifecycleEventSchema.parse({
      event_id: 'event_01',
      event_type: 'run.state_changed',
      entity_type: 'run',
      entity_id: 'run_01',
      workspace_id: workspaceId,
      sequence: 4,
      occurred_at: timestamps.updated_at,
      request_id: 'request_01',
      actor: 'agent',
      state: 'running',
    });
    expect(event.sequence).toBe(4);

    expect(
      platformCommandAcceptedSchema.parse({
        request_id: 'request_01',
        object_type: 'run',
        object_id: 'run_01',
      }),
    ).toEqual({
      request_id: 'request_01',
      object_type: 'run',
      object_id: 'run_01',
    });
  });
});
