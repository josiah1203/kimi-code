'use client';

import {
  BrowserPlatformClient,
  type BrowserPlatformClientOptions,
  type BrowserPlatformEventHandlers,
  type BrowserPlatformEventOptions,
  type BrowserPlatformEventSubscription,
  type BrowserCollaborationEventHandlers,
  type BrowserCollaborationEventOptions,
  type BrowserCollaborationEventSubscription,
  type BrowserWebSocketLike,
  type BrowserTranscriptPage,
} from '@spiderbyte/client/browser';
import {
  collaborationMessageCreateInputSchema,
  collaborationMessageCancelInputSchema,
  collaborationMessageCommandInputSchema,
  collaborationMessageCommandResultSchema,
  collaborationMessagePageSchema,
  collaborationMessageSchema,
  collaborationMessageUpdateInputSchema,
  collaborationChannelSchema,
  collaborationThreadCreateInputSchema,
  collaborationThreadPageSchema,
  collaborationThreadSchema,
  approvalResolveRequestSchema,
  approvalResolveResultSchema,
  listPendingApprovalsResponseSchema,
  listWorkspacesResponseSchema,
  organizationSchema,
  projectSchema,
  promptAbortResponseSchema,
  promptSubmissionSchema,
  promptSubmitResultSchema,
  sessionCreateSchema,
  sessionSchema,
  type PromptSubmission,
  type PromptSubmitResult,
  type PromptAbortResponse,
  type CollaborationChannel,
  type CollaborationMessage,
  type CollaborationMessageCommandInput,
  type CollaborationMessageCommandResult,
  type CollaborationMessageCancelInput,
  type CollaborationMessageCreateInput,
  type CollaborationMessagePage,
  type CollaborationMessageUpdateInput,
  type CollaborationThread,
  type CollaborationThreadPage,
  type Organization,
  type Project,
  type Session,
  type Workspace,
  type ApprovalRequest,
  type ApprovalResponse,
  type ApprovalResolveResult,
} from '@spiderbyte/protocol';

interface WorkspaceListResponse {
  readonly items: readonly Workspace[];
}

export interface SpiderByteWebClient {
  readonly platform: BrowserPlatformClient;
  listOrganizations(): Promise<readonly Organization[]>;
  listProjects(organizationId?: string): Promise<readonly Project[]>;
  listWorkspaces(): Promise<readonly Workspace[]>;
  listCollaborationChannels(workspaceId: string): Promise<readonly CollaborationChannel[]>;
  listCollaborationThreads(workspaceId: string, channelId: string): Promise<CollaborationThreadPage>;
  listCollaborationMessages(
    workspaceId: string,
    channelId: string,
    options?: { readonly afterSequence?: number; readonly limit?: number; readonly threadId?: string },
  ): Promise<CollaborationMessagePage>;
  createCollaborationThread(workspaceId: string, channelId: string, title: string): Promise<CollaborationThread>;
  createCollaborationMessage(
    workspaceId: string,
    channelId: string,
    input: Omit<CollaborationMessageCreateInput, 'request_id'>,
  ): Promise<CollaborationMessage>;
  submitCollaborationCommand(
    workspaceId: string,
    channelId: string,
    input: Omit<CollaborationMessageCommandInput, 'request_id'>,
  ): Promise<CollaborationMessageCommandResult>;
  cancelCollaborationMessage(
    workspaceId: string,
    channelId: string,
    messageId: string,
    input?: Omit<CollaborationMessageCancelInput, 'request_id'>,
  ): Promise<CollaborationMessageCommandResult>;
  updateCollaborationMessage(
    workspaceId: string,
    channelId: string,
    messageId: string,
    input: Omit<CollaborationMessageUpdateInput, 'request_id'>,
  ): Promise<CollaborationMessage>;
  getWorkspaceProject(workspaceId: string): Promise<Project | undefined>;
  createSession(workspaceId: string, title: string): Promise<Session>;
  getSession(sessionId: string): Promise<Session | undefined>;
  listPendingApprovals(sessionId: string): Promise<readonly ApprovalRequest[]>;
  resolveApproval(sessionId: string, approvalId: string, input: ApprovalResponse): Promise<ApprovalResolveResult | undefined>;
  submitPrompt(sessionId: string, input: PromptSubmission): Promise<PromptSubmitResult>;
  abortPrompt(sessionId: string, promptId: string): Promise<PromptAbortResponse | undefined>;
  getTranscript(workspaceId: string, sessionId: string, options?: { readonly pageSize?: number }): Promise<BrowserTranscriptPage | undefined>;
  subscribeEvents(
    workspaceId: string,
    handlers: BrowserPlatformEventHandlers,
    options?: BrowserPlatformEventOptions,
  ): BrowserPlatformEventSubscription;
  subscribeCollaboration(
    workspaceId: string,
    channelId: string,
    handlers: BrowserCollaborationEventHandlers,
    options?: BrowserCollaborationEventOptions,
  ): BrowserCollaborationEventSubscription;
}

export function createSpiderByteWebClient(
  token?: BrowserPlatformClientOptions['token'],
): SpiderByteWebClient {
  const platform = new BrowserPlatformClient({
    // An empty base keeps REST calls same-origin so the Next.js BFF owns the
    // hosted identity boundary. The optional WS URL bypasses the HTTP BFF only
    // for an explicitly configured, authorized SpiderByte WS endpoint.
    baseUrl: '',
    token,
    webSocketProtocols: process.env.NEXT_PUBLIC_SPIDERBYTE_WS_URL === undefined
      ? undefined
      : async () => {
        const response = await fetch('/api/identity/ws', { cache: 'no-store' });
        if (!response.ok) throw new Error('SpiderByte realtime identity is unavailable.');
        const data = await response.json() as { readonly assertion?: unknown };
        if (typeof data.assertion !== 'string' || data.assertion.length === 0) {
          throw new Error('SpiderByte realtime identity returned an invalid assertion.');
        }
        return [`spiderbyte.identity.${data.assertion}`];
      },
    webSocket: (url, protocols) => {
      const normalizedProtocols = protocols === undefined
        ? undefined
        : typeof protocols === 'string'
          ? protocols
          : [...protocols];
      return new WebSocket(resolveWebSocketUrl(url), normalizedProtocols) as unknown as BrowserWebSocketLike;
    },
  });

  return {
    platform,
    listOrganizations: async () => {
      const response = await request<readonly Organization[]>(
        platform,
        '/api/v2/organizations',
        'GET',
        undefined,
        organizationSchema.array(),
      );
      return response ?? [];
    },
    listProjects: async (organizationId) => {
      const query = organizationId === undefined ? '' : `?organization_id=${encodeURIComponent(requireId(organizationId, 'organizationId'))}`;
      const response = await request<readonly Project[]>(
        platform,
        `/api/v2/projects${query}`,
        'GET',
        undefined,
        projectSchema.array(),
      );
      return response ?? [];
    },
    listWorkspaces: async () => {
      const response = await request<WorkspaceListResponse>(
        platform,
        '/api/v1/workspaces',
        'GET',
        undefined,
        listWorkspacesResponseSchema,
      );
      return response?.items ?? [];
    },
    listCollaborationChannels: async (workspaceId) => {
      const response = await request<readonly CollaborationChannel[]>(
        platform,
        `/api/v2/workspaces/${encodeURIComponent(requireId(workspaceId, 'workspaceId'))}/collaboration/channels`,
        'GET',
        undefined,
        collaborationChannelSchema.array(),
      );
      return response ?? [];
    },
    listCollaborationThreads: async (workspaceId, channelId) => {
      const response = await request<CollaborationThreadPage>(
        platform,
        `/api/v2/workspaces/${encodeURIComponent(requireId(workspaceId, 'workspaceId'))}/collaboration/channels/${encodeURIComponent(requireId(channelId, 'channelId'))}/threads`,
        'GET',
        undefined,
        collaborationThreadPageSchema,
      );
      return response ?? { items: [] };
    },
    listCollaborationMessages: async (workspaceId, channelId, options) => {
      const query = new URLSearchParams();
      if (options?.afterSequence !== undefined) query.set('after_sequence', String(options.afterSequence));
      if (options?.limit !== undefined) query.set('limit', String(options.limit));
      if (options?.threadId !== undefined) query.set('thread_id', requireId(options.threadId, 'threadId'));
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      const response = await request<CollaborationMessagePage>(
        platform,
        `/api/v2/workspaces/${encodeURIComponent(requireId(workspaceId, 'workspaceId'))}/collaboration/channels/${encodeURIComponent(requireId(channelId, 'channelId'))}/messages${suffix}`,
        'GET',
        undefined,
        collaborationMessagePageSchema,
      );
      return response ?? { items: [] };
    },
    createCollaborationThread: async (workspaceId, channelId, title) => {
      const response = await request<CollaborationThread>(
        platform,
        `/api/v2/workspaces/${encodeURIComponent(requireId(workspaceId, 'workspaceId'))}/collaboration/channels/${encodeURIComponent(requireId(channelId, 'channelId'))}/threads`,
        'POST',
        collaborationThreadCreateInputSchema.parse({ request_id: makeRequestId(), title }),
        collaborationThreadSchema,
      );
      if (response === undefined) throw new Error('SpiderByte did not return the created collaboration thread.');
      return response;
    },
    createCollaborationMessage: async (workspaceId, channelId, input) => {
      const response = await request<CollaborationMessage>(
        platform,
        `/api/v2/workspaces/${encodeURIComponent(requireId(workspaceId, 'workspaceId'))}/collaboration/channels/${encodeURIComponent(requireId(channelId, 'channelId'))}/messages`,
        'POST',
        collaborationMessageCreateInputSchema.parse({ request_id: makeRequestId(), ...input }),
        collaborationMessageSchema,
      );
      if (response === undefined) throw new Error('SpiderByte did not return the created collaboration message.');
      return response;
    },
    submitCollaborationCommand: async (workspaceId, channelId, input) => {
      const response = await request<CollaborationMessageCommandResult>(
        platform,
        `/api/v2/workspaces/${encodeURIComponent(requireId(workspaceId, 'workspaceId'))}/collaboration/channels/${encodeURIComponent(requireId(channelId, 'channelId'))}/messages/command`,
        'POST',
        collaborationMessageCommandInputSchema.parse({ request_id: makeRequestId(), ...input }),
        collaborationMessageCommandResultSchema,
      );
      if (response === undefined) throw new Error('SpiderByte did not return the collaboration command result.');
      return response;
    },
    cancelCollaborationMessage: async (workspaceId, channelId, messageId, input) => {
      const response = await request<CollaborationMessageCommandResult>(
        platform,
        `/api/v2/workspaces/${encodeURIComponent(requireId(workspaceId, 'workspaceId'))}/collaboration/channels/${encodeURIComponent(requireId(channelId, 'channelId'))}/messages/${encodeURIComponent(requireId(messageId, 'messageId'))}/cancel`,
        'POST',
        collaborationMessageCancelInputSchema.parse({ request_id: makeRequestId(), ...input }),
        collaborationMessageCommandResultSchema,
      );
      if (response === undefined) throw new Error('SpiderByte did not return the collaboration cancellation result.');
      return response;
    },
    updateCollaborationMessage: async (workspaceId, channelId, messageId, input) => {
      const response = await request<CollaborationMessage>(
        platform,
        `/api/v2/workspaces/${encodeURIComponent(requireId(workspaceId, 'workspaceId'))}/collaboration/channels/${encodeURIComponent(requireId(channelId, 'channelId'))}/messages/${encodeURIComponent(requireId(messageId, 'messageId'))}`,
        'PATCH',
        collaborationMessageUpdateInputSchema.parse({ request_id: makeRequestId(), ...input }),
        collaborationMessageSchema,
      );
      if (response === undefined) throw new Error('SpiderByte did not return the updated collaboration message.');
      return response;
    },
    getWorkspaceProject: (workspaceId) => request<Project>(
      platform,
      `/api/v2/workspaces/${encodeURIComponent(requireId(workspaceId, 'workspaceId'))}/platform/project`,
      'GET',
      undefined,
      projectSchema,
    ),
    createSession: async (workspaceId, title) => {
      const response = await request<Session>(
        platform,
        '/api/v1/sessions',
        'POST',
        sessionCreateSchema.parse({ workspace_id: workspaceId, title }),
        sessionSchema,
      );
      if (response === undefined) throw new Error('SpiderByte did not return the created session.');
      return response;
    },
    getSession: (sessionId) => request<Session>(
      platform,
      `/api/v1/sessions/${encodeURIComponent(requireId(sessionId, 'sessionId'))}`,
      'GET',
      undefined,
      sessionSchema,
    ),
    listPendingApprovals: async (sessionId) => {
      const response = await request<{ readonly items: readonly ApprovalRequest[] }>(
        platform,
        `/api/v1/sessions/${encodeURIComponent(requireId(sessionId, 'sessionId'))}/approvals?status=pending`,
        'GET',
        undefined,
        listPendingApprovalsResponseSchema,
      );
      return response?.items ?? [];
    },
    resolveApproval: (sessionId, approvalId, input) => request<ApprovalResolveResult>(
      platform,
      `/api/v1/sessions/${encodeURIComponent(requireId(sessionId, 'sessionId'))}/approvals/${encodeURIComponent(requireId(approvalId, 'approvalId'))}`,
      'POST',
      approvalResolveRequestSchema.parse(input),
      approvalResolveResultSchema,
    ),
    submitPrompt: async (sessionId, input) => {
      const response = await request<PromptSubmitResult>(
        platform,
        `/api/v1/sessions/${encodeURIComponent(requireId(sessionId, 'sessionId'))}/prompts`,
        'POST',
        promptSubmissionSchema.parse(input),
        promptSubmitResultSchema,
      );
      if (response === undefined) throw new Error('SpiderByte did not return the submitted prompt.');
      return response;
    },
    abortPrompt: (sessionId, promptId) => request<PromptAbortResponse>(
      platform,
      `/api/v1/sessions/${encodeURIComponent(requireId(sessionId, 'sessionId'))}/prompts/${encodeURIComponent(requireId(promptId, 'promptId'))}:abort`,
      'POST',
      undefined,
      promptAbortResponseSchema,
    ),
    getTranscript: (workspaceId, sessionId, options) => platform.workspace(workspaceId).getTranscript(
      sessionId,
      'main',
      options,
    ),
    subscribeEvents: (workspaceId, handlers, options) => platform.workspace(workspaceId).subscribeEvents(handlers, options),
    subscribeCollaboration: (workspaceId, channelId, handlers, options) => platform.workspace(workspaceId).subscribeCollaboration(channelId, handlers, options),
  };
}

async function request<T>(
  platform: BrowserPlatformClient,
  path: string,
  method: string,
  body: unknown,
  schema: Parameters<BrowserPlatformClient['request']>[3],
): Promise<T | undefined> {
  return platform.request(path, method, body, schema) as unknown as Promise<T | undefined>;
}

function resolveWebSocketUrl(url: string): string {
  const explicit = process.env.NEXT_PUBLIC_SPIDERBYTE_WS_URL;
  if (explicit) {
    const platformPath = '/api/v2/platform/ws';
    const collaborationPath = '/api/v2/collaboration/ws';
    if (url.endsWith(collaborationPath) && explicit.endsWith(platformPath)) {
      return `${explicit.slice(0, -platformPath.length)}${collaborationPath}`;
    }
    return explicit;
  }
  if (/^wss?:\/\//.test(url)) return url;
  if (typeof window === 'undefined') return url;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${url}`;
}

function requireId(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  return normalized;
}

function makeRequestId(): string {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `web_${random}`;
}
