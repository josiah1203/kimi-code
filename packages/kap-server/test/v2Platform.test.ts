import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { IFlagService } from '@spiderbyte/agent-core';
import { type RunningServer, startServer } from '../src/start';
import { authedFetch } from './helpers/auth';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';

interface Envelope<T> {
  code: number;
  msg: string;
  data: T | null;
  request_id: string;
}

interface WorkspaceWire {
  id: string;
  root: string;
}

function rawDataToText(raw: WebSocket.RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString();
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString();
  return raw.toString();
}

function createMessageReader(socket: WebSocket): () => Promise<unknown> {
  const pending: unknown[] = [];
  const waiters: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }> = [];
  socket.on('message', (raw: WebSocket.RawData) => {
    try {
      const message = JSON.parse(rawDataToText(raw)) as unknown;
      const waiter = waiters.shift();
      if (waiter === undefined) pending.push(message);
      else waiter.resolve(message);
    } catch (error) {
      const waiter = waiters.shift();
      if (waiter === undefined) return;
      waiter.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
  socket.on('error', (error) => {
    while (waiters.length > 0) waiters.shift()?.reject(error);
  });
  return () => {
    const message = pending.shift();
    if (message !== undefined) return Promise.resolve(message);
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  };
}

describe('server /api/v2 platform surface', () => {
  let server: RunningServer | undefined;
  let home: string | undefined;
  let base: string;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    vi.stubEnv('SPIDERBYTE_EXPERIMENTAL_PLATFORM_SERVICES', '1');
    // The server derives the local principal from host configuration; request
    // bodies cannot impersonate `actor_id` anymore.
    vi.stubEnv('SPIDERBYTE_LOCAL_ACTOR_ID', 'local-admin');
    home = await mkdtemp(join(tmpdir(), 'spiderbyte-server-platform-'));
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const socket of sockets.splice(0)) socket.close();
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
    if (home !== undefined) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  it('serves canonical workspace projections with request envelopes', async () => {
    const root = home as string;
    const workspaceResponse = await authedFetch(server as RunningServer, base, '/api/v1/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root, name: 'platform-test' }),
    });
    const workspace = (await workspaceResponse.json()) as Envelope<WorkspaceWire>;
    expect(workspace.code).toBe(0);
    const workspaceId = workspace.data?.id as string;

    const connectionsResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/connections`,
    );
    const emptyConnections = (await connectionsResponse.json()) as Envelope<readonly unknown[]>;
    expect(emptyConnections).toMatchObject({ code: 0, data: [], request_id: expect.any(String) });

    const missingConnectionResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/connections/conn_missing`,
    );
    const missingConnection = (await missingConnectionResponse.json()) as Envelope<null>;
    expect(missingConnection).toMatchObject({
      code: 40418,
      data: null,
      request_id: expect.any(String),
    });

    const createConnectionResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/connections`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'connection_create',
          name: 'customer-openai',
          provider: 'openai-compatible',
          scope: 'workspace',
          secret_ref: 'secret_customer_openai',
          capabilities: ['chat'],
        }),
      },
    );
    const connection = (await createConnectionResponse.json()) as Envelope<Record<string, unknown>>;
    expect(connection.code).toBe(0);
    expect(connection.data).toMatchObject({ state: 'configured', secret_ref: 'secret_customer_openai' });
    expect(connection.data).not.toHaveProperty('api_key');

    const targetsResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/execution-targets`,
    );
    expect(await targetsResponse.json()).toMatchObject({ code: 0, data: [] });
    const targetCreateResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/execution-targets`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'target_create',
          name: 'local-target',
          type: 'local',
          locality: 'local',
          capabilities: ['analysis'],
        }),
      },
    );
    const target = (await targetCreateResponse.json()) as Envelope<{
      id: string;
      workspace_id: string;
      health_status: string;
      authentication_method: string;
    }>;
    expect(target).toMatchObject({
      code: 0,
      data: {
        workspace_id: workspaceId,
        health_status: 'unknown',
        authentication_method: 'none',
      },
    });
    const targetId = target.data?.id as string;
    const targetTestResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/execution-targets/${targetId}/test`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: 'target_test' }),
      },
    );
    expect(await targetTestResponse.json()).toMatchObject({
      code: 0,
      data: { target_id: targetId, workspace_id: workspaceId, status: 'healthy' },
    });
    const targetRevokeResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/execution-targets/${targetId}/revoke`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: 'target_revoke' }),
      },
    );
    expect(await targetRevokeResponse.json()).toMatchObject({ code: 0, data: { state: 'disabled' } });

    const policyResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/policy/evaluate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'policy_explain',
          capability: 'network',
          action: 'fetch:example.test',
          requested_by: 'agent',
        }),
      },
    );
    const policy = (await policyResponse.json()) as Envelope<{ id: string; reason: string }>;
    const explanationResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/policy/decisions/${policy.data?.id}/explain`,
    );
    const explanation = (await explanationResponse.json()) as Envelope<{ id: string; reason: string }>;
    expect(explanation).toMatchObject({ code: 0, data: { id: policy.data?.id } });

    const eventsResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/events?after_sequence=0&limit=10`,
    );
    const events = (await eventsResponse.json()) as Envelope<{ events: unknown[]; next_sequence: number }>;
    expect(events.code).toBe(0);
    expect(events.data?.events.length).toBeGreaterThan(0);
    expect(events.data?.next_sequence).toBeGreaterThan(0);
  });

  it('serves the accountless organization, project, and workspace binding API', async () => {
    const root = home as string;
    const identityResponse = await authedFetch(server as RunningServer, base, '/api/v2/auth/status');
    expect(await identityResponse.json()).toMatchObject({
      code: 0,
      data: { mode: 'local', authenticated: false, credential_class: 'account' },
    });
    const workspaceResponse = await authedFetch(server as RunningServer, base, '/api/v1/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root, name: 'governance-test' }),
    });
    const workspace = (await workspaceResponse.json()) as Envelope<WorkspaceWire>;
    const workspaceId = workspace.data?.id as string;

    const organizationResponse = await authedFetch(
      server as RunningServer,
      base,
      '/api/v2/organizations/local',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor_id: 'local-admin' }),
      },
    );
    const organization = (await organizationResponse.json()) as Envelope<{ id: string; mode: string }>;
    expect(organization).toMatchObject({ code: 0, data: { mode: 'local' } });

    const projectResponse = await authedFetch(server as RunningServer, base, '/api/v2/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'governance_project_create',
        actor_id: 'request-body-attacker',
        organization_id: organization.data?.id,
        name: 'Governance test',
      }),
    });
    const project = (await projectResponse.json()) as Envelope<{ id: string; workspace_ids: string[] }>;
    expect(project).toMatchObject({ code: 0, data: { workspace_ids: [] } });

    const bindResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/projects/${project.data?.id}/workspaces`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'governance_workspace_bind',
          actor_id: 'local-admin',
          workspace_id: workspaceId,
        }),
      },
    );
    const bound = (await bindResponse.json()) as Envelope<{ workspace_ids: string[] }>;
    expect(bound).toMatchObject({ code: 0, data: { workspace_ids: [workspaceId] } });

    const bindingResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/projects/${project.data?.id}/bindings`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'governance_project_binding',
          actor_id: 'local-admin',
          kind: 'llm_connection',
          resource_id: 'connection_openrouter_managed',
          role: 'default',
          workspace_id: workspaceId,
        }),
      },
    );
    const binding = (await bindingResponse.json()) as Envelope<{
      id: string;
      project_id: string;
      resource_id: string;
      state: string;
    }>;
    expect(binding).toMatchObject({
      code: 0,
      data: {
        project_id: project.data?.id,
        resource_id: 'connection_openrouter_managed',
        state: 'active',
      },
    });

    const bindingsResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/projects/${project.data?.id}/bindings?workspace_id=${workspaceId}`,
    );
    expect(await bindingsResponse.json()).toMatchObject({
      code: 0,
      data: [expect.objectContaining({ id: binding.data?.id })],
    });

    const revokeResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/projects/${project.data?.id}/bindings/${binding.data?.id}/revoke`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: 'governance_project_binding_revoke', actor_id: 'local-admin' }),
      },
    );
    expect(await revokeResponse.json()).toMatchObject({
      code: 0,
      data: { id: binding.data?.id, state: 'disabled' },
    });

    const authorizationResponse = await authedFetch(
      server as RunningServer,
      base,
      '/api/v2/authorization/evaluate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'governance_authorization_evaluate',
          actor_id: 'request-body-attacker',
          project_id: project.data?.id,
          workspace_id: workspaceId,
          capability: 'run.execute',
        }),
      },
    );
    expect(await authorizationResponse.json()).toMatchObject({
      code: 0,
      data: { allowed: true, role: 'organization_owner' },
    });

    const pluginManifest = {
      id: 'example.integration',
      name: 'Example integration',
      version: '1.0.0',
      provider_type: 'example',
      authentication: { kind: 'oauth2', scopes: ['messages:write'] },
      commands: [{ id: 'run', name: 'Run', description: 'Run an operation', capability: 'run.execute' }],
    };
    const pluginResponse = await authedFetch(
      server as RunningServer,
      base,
      '/api/v2/plugins',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'governance_plugin_install',
          actor_id: 'local-admin',
          project_id: project.data?.id,
          manifest: pluginManifest,
        }),
      },
    );
    const plugin = (await pluginResponse.json()) as Envelope<{ id: string; state: string }>;
    expect(plugin).toMatchObject({ code: 0, data: { state: 'installed' } });

    const configurePluginResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/plugins/${plugin.data?.id}/configure`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'governance_plugin_configure',
          actor_id: 'local-admin',
          project_id: project.data?.id,
          connection_id: 'connection_example_plugin',
        }),
      },
    );
    expect(await configurePluginResponse.json()).toMatchObject({
      code: 0,
      data: { id: plugin.data?.id, state: 'configured', connection_id: 'connection_example_plugin' },
    });

    const projectLookup = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/project`,
    );
    expect(await projectLookup.json()).toMatchObject({ code: 0, data: { id: project.data?.id } });

    vi.stubEnv('SPIDERBYTE_LOCAL_ACTOR_ID', 'other-actor');
    expect(await (await authedFetch(server as RunningServer, base, '/api/v2/organizations')).json()).toMatchObject({
      code: 0,
      data: [],
    });
    expect(await (await authedFetch(server as RunningServer, base, '/api/v2/projects')).json()).toMatchObject({
      code: 0,
      data: [],
    });
    expect(await (await authedFetch(server as RunningServer, base, '/api/v2/plugins')).json()).toMatchObject({
      code: 0,
      data: [],
    });
    expect(await (await authedFetch(server as RunningServer, base, '/api/v1/workspaces')).json()).toMatchObject({
      code: 0,
      data: { items: [] },
    });
    expect(await (await authedFetch(server as RunningServer, base, `/api/v1/workspaces/${workspaceId}/skills`)).json()).toMatchObject({
      code: 40302,
      data: null,
    });
    expect(await (await authedFetch(server as RunningServer, base, `/api/v2/projects/${project.data?.id}`)).json()).toMatchObject({
      code: 40302,
      data: null,
    });
    expect(await (await authedFetch(server as RunningServer, base, `/api/v2/plugins/${plugin.data?.id}`)).json()).toMatchObject({
      code: 40302,
      data: null,
    });
    expect(await (await authedFetch(server as RunningServer, base, `/api/v2/workspaces/${workspaceId}/platform/connections`)).json()).toMatchObject({
      code: 40302,
      data: null,
    });

    const token = (server as RunningServer).authTokenService.getToken();
    const socket = new WebSocket(`ws://127.0.0.1:${server?.port}/api/v2/platform/ws`, {
      headers: { authorization: `Bearer ${token}` },
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => { resolve(); });
      socket.once('error', reject);
    });
    const nextMessage = createMessageReader(socket);
    socket.send(JSON.stringify({
      type: 'subscribe',
      request_id: 'ws_cross_workspace_denied',
      workspace_id: workspaceId,
    }));
    expect(await nextMessage()).toMatchObject({
      type: 'ack',
      request_id: 'ws_cross_workspace_denied',
      code: 40302,
      data: null,
    });
  });

  it('keeps the platform routes disabled unless the experimental flag is enabled', async () => {
    const disabledHome = await mkdtemp(join(tmpdir(), 'spiderbyte-server-platform-disabled-'));
    vi.stubEnv('SPIDERBYTE_EXPERIMENTAL_PLATFORM_SERVICES', '0');
    const disabledServer = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: disabledHome,
      logLevel: 'silent',
    });

    try {
      expect(disabledServer.core.accessor.get(IFlagService).enabled('platform_services')).toBe(false);
      const workspaceResponse = await authedFetch(
        disabledServer,
        `http://127.0.0.1:${disabledServer.port}`,
        '/api/v1/workspaces',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ root: disabledHome }),
        },
      );
      const workspace = (await workspaceResponse.json()) as Envelope<WorkspaceWire>;
      const platformResponse = await authedFetch(
        disabledServer,
        `http://127.0.0.1:${disabledServer.port}`,
        `/api/v2/workspaces/${workspace.data?.id}/platform/connections`,
      );
      const envelope = (await platformResponse.json()) as Envelope<null>;
      // Platform errors use the shared envelope convention; HTTP status is
      // reserved for transport/authentication failures.
      expect(platformResponse.status).toBe(200);
      expect(envelope).toMatchObject({ code: 40301, data: null, request_id: expect.any(String) });
    } finally {
      vi.stubEnv('SPIDERBYTE_EXPERIMENTAL_PLATFORM_SERVICES', '1');
      await disabledServer.close();
      await rm(disabledHome, { recursive: true, force: true });
    }
  });

  it('honors the emergency rollback even when platform activation is requested', async () => {
    const rollbackHome = await mkdtemp(join(tmpdir(), 'spiderbyte-server-platform-rollback-'));
    vi.stubEnv('SPIDERBYTE_EXPERIMENTAL_PLATFORM_SERVICES', '1');
    vi.stubEnv('SPIDERBYTE_EXPERIMENTAL_FLAG', '1');
    vi.stubEnv('SPIDERBYTE_DISABLE_PLATFORM_SERVICES', '1');
    const rollbackServer = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: rollbackHome,
      logLevel: 'silent',
    });

    try {
      const flagService = rollbackServer.core.accessor.get(IFlagService);
      expect(flagService.enabled('platform_services')).toBe(false);
      expect(flagService.explain('platform_services')).toMatchObject({
        source: 'emergency-disable-env',
        emergencyDisableEnv: 'SPIDERBYTE_DISABLE_PLATFORM_SERVICES',
      });

      const workspaceResponse = await authedFetch(
        rollbackServer,
        `http://127.0.0.1:${rollbackServer.port}`,
        '/api/v1/workspaces',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ root: rollbackHome }),
        },
      );
      const workspace = (await workspaceResponse.json()) as Envelope<WorkspaceWire>;
      const platformResponse = await authedFetch(
        rollbackServer,
        `http://127.0.0.1:${rollbackServer.port}`,
        `/api/v2/workspaces/${workspace.data?.id}/platform/connections`,
      );
      const envelope = (await platformResponse.json()) as Envelope<null>;
      expect(platformResponse.status).toBe(200);
      expect(envelope).toMatchObject({ code: 40301, data: null, request_id: expect.any(String) });
    } finally {
      await rollbackServer.close();
      await rm(rollbackHome, { recursive: true, force: true });
    }
  });

  it('replays and streams platform events over the authenticated websocket', async () => {
    const root = home as string;
    const workspaceResponse = await authedFetch(server as RunningServer, base, '/api/v1/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root }),
    });
    const workspace = (await workspaceResponse.json()) as Envelope<WorkspaceWire>;
    const workspaceId = workspace.data?.id as string;

    await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/policy/evaluate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'policy_ws_replay',
          capability: 'network',
          action: 'web-search',
          requested_by: 'user',
        }),
      },
    );

    const token = (server as RunningServer).authTokenService.getToken();
    const socket = new WebSocket(`ws://127.0.0.1:${server?.port}/api/v2/platform/ws`, {
      headers: { authorization: `Bearer ${token}` },
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => { resolve(); });
      socket.once('error', reject);
    });
    const nextMessage = createMessageReader(socket);
    socket.send(JSON.stringify({
      type: 'subscribe',
      request_id: 'ws_subscribe',
      workspace_id: workspaceId,
      after_sequence: 0,
      limit: 20,
      event_types: ['policy_decision.evaluated'],
    }));

    const ack = (await nextMessage()) as { type: string; request_id: string; code: number; data: { events: unknown[] } };
    const event = (await nextMessage()) as { type: string; event: { workspace_id: string } };
    expect(ack).toMatchObject({ type: 'ack', request_id: 'ws_subscribe', code: 0 });
    expect(ack.data.events.length).toBeGreaterThan(0);
    expect(event).toMatchObject({
      type: 'platform_event',
      event: { workspace_id: workspaceId, event_type: 'policy_decision.evaluated' },
    });
  });

  it('executes a local ML workflow through the authenticated REST surface', async () => {
    const root = home as string;
    const workspaceResponse = await authedFetch(server as RunningServer, base, '/api/v1/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root, name: 'ml-platform-test' }),
    });
    const workspace = (await workspaceResponse.json()) as Envelope<WorkspaceWire>;
    const workspaceId = workspace.data?.id as string;

    const rulesResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/policy/rules`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'ml_rules',
          rules: [
            { capability: 'dataset', effect: 'allow', reason: 'test dataset access' },
            { capability: 'model', effect: 'allow', reason: 'test model access' },
          ],
        }),
      },
    );
    expect((await rulesResponse.json() as Envelope<unknown>).code).toBe(0);

    const datasetResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/datasets`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'ml_dataset',
          name: 'churn',
          format: 'csv',
          content_base64: Buffer.from('feature,target\n1,yes\n2,yes\n3,no\n', 'utf8').toString('base64'),
        }),
      },
    );
    const dataset = (await datasetResponse.json()) as Envelope<{ id: string; current_version: number }>;
    expect(dataset).toMatchObject({ code: 0, data: { id: expect.any(String), current_version: 1 } });

    const analysisResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/ml/analyses`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'ml_analysis',
          run_id: 'run_ml_analysis',
          dataset_id: dataset.data?.id,
          kind: 'visualization',
          columns: ['feature', 'target'],
          group_by: 'target',
        }),
      },
    );
    const analysis = (await analysisResponse.json()) as Envelope<{ report_artifact_id: string; visualization_artifact_ids: string[] }>;
    expect(analysis).toMatchObject({
      code: 0,
      data: { report_artifact_id: expect.any(String), visualization_artifact_ids: [expect.any(String)] },
    });

    const experimentResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/ml/experiments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'ml_experiment',
          name: 'baseline churn',
          dataset_id: dataset.data?.id,
          target: 'target',
          features: ['feature'],
          task: 'classification',
          algorithm: 'majority',
          metrics: [{ name: 'accuracy' }],
        }),
      },
    );
    const experiment = (await experimentResponse.json()) as Envelope<{ id: string; state: string }>;
    expect(experiment).toMatchObject({ code: 0, data: { id: expect.any(String), state: 'ready' } });

    const trainResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/ml/experiments/${experiment.data?.id}/train`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: 'ml_train', run_id: 'run_ml_rest' }),
      },
    );
    const training = (await trainResponse.json()) as Envelope<{ status: string; model_artifact_id: string }>;
    expect(training).toMatchObject({ code: 0, data: { status: 'succeeded', model_artifact_id: expect.any(String) } });

    const listResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/ml/training-runs?experiment_id=${experiment.data?.id}`,
    );
    const trainingRuns = (await listResponse.json()) as Envelope<readonly unknown[]>;
    expect(trainingRuns).toMatchObject({ code: 0, data: [expect.objectContaining({ status: 'succeeded' })] });

    const pipelineCreateResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/pipelines`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'ml_pipeline_create',
          name: 'daily churn analysis',
          steps: [{ id: 'analysis', name: 'Analyze churn', kind: 'analysis', config: { dataset_id: dataset.data?.id, kind: 'visualization' } }],
        }),
      },
    );
    const pipeline = (await pipelineCreateResponse.json()) as Envelope<{ id: string; state: string }>;
    expect(pipeline).toMatchObject({ code: 0, data: { id: expect.any(String), state: 'ready' } });
    const pipelineRunResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/platform/pipelines/${pipeline.data?.id}/run`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: 'ml_pipeline_run', run_id: 'run_ml_pipeline' }),
      },
    );
    const pipelineRun = (await pipelineRunResponse.json()) as Envelope<{ status: string; output_artifact_ids: string[] }>;
    expect(pipelineRun).toMatchObject({ code: 0, data: { status: 'succeeded', output_artifact_ids: [expect.any(String), expect.any(String)] } });
  });
});
