import { describe, expect, it } from 'vitest';

import {
  agentSessionSchema,
  artifactSchema,
  executionTargetSchema,
  executionTargetCreateInputSchema,
  platformCommandAcceptedSchema,
  platformLifecycleEventSchema,
  platformWorkspaceSchema,
  policyDecisionAuditInputSchema,
  policyEvaluateInputSchema,
  policyDecisionSchema,
  policyRuleSchema,
  providerConnectionCreateInputSchema,
  providerConnectionSchema,
  resourceSchema,
  runCreateInputSchema,
  runSchema,
  runTransitionInputSchema,
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
      platformLifecycleEventSchema.safeParse({
        event_id: 'event_02',
        event_type: 'run.created',
        entity_type: 'workspace',
        entity_id: 'run_01',
        workspace_id: workspaceId,
        sequence: 5,
        occurred_at: timestamps.updated_at,
        actor: 'agent',
      }).success,
    ).toBe(false);

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

  it('requires request ids on Run mutations', () => {
    expect(
      runCreateInputSchema.parse({
        request_id: 'req_1',
        metadata: { source: 'test' },
      }),
    ).toMatchObject({ request_id: 'req_1' });
    expect(
      runTransitionInputSchema.parse({
        request_id: 'req_2',
        status: 'running',
      }),
    ).toMatchObject({ status: 'running' });
    expect(() => runCreateInputSchema.parse({ metadata: {} })).toThrow();
    expect(() => runTransitionInputSchema.parse({ status: 'cancelled' })).toThrow();
  });

  it('requires reference-only provider commands and typed policy inputs', () => {
    expect(
      providerConnectionCreateInputSchema.parse({
        request_id: 'request_connection',
        name: 'OpenAI',
        provider: 'openai',
        scope: 'workspace',
        secret_ref: 'secret_openai',
      }),
    ).toMatchObject({ capabilities: [] });
    expect(() =>
      providerConnectionCreateInputSchema.parse({
        request_id: 'request_connection',
        name: 'OpenAI',
        provider: 'openai',
        scope: 'workspace',
        secret_ref: 'sk-live-key',
      }),
    ).toThrow();

    expect(
      policyRuleSchema.parse({
        capability: 'deploy',
        effect: 'approval_required',
        reason: 'Production changes require review.',
      }).effect,
    ).toBe('approval_required');
    expect(
      policyEvaluateInputSchema.parse({
        request_id: 'request_policy',
        capability: 'deploy',
        action: 'production:deploy',
        requested_by: 'agent',
      }).requested_by,
    ).toBe('agent');
    expect(policyDecisionAuditInputSchema.parse({ request_id: 'request_audit' })).toMatchObject({
      request_id: 'request_audit',
    });

    expect(
      executionTargetCreateInputSchema.parse({
        request_id: 'request_target',
        name: 'customer worker',
        type: 'customer-managed',
        locality: 'customer-region',
        credential_ref: 'secret_worker',
      }),
    ).toMatchObject({ credential_ref: 'secret_worker' });
    expect(() => executionTargetCreateInputSchema.parse({
      request_id: 'request_target',
      name: 'customer worker',
      type: 'customer-managed',
      locality: 'customer-region',
      credential_ref: 'credential_worker',
    })).toThrow();
  });
});
