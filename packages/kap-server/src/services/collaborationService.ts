import { createHash } from 'node:crypto';
import { join } from 'node:path';

import {
  IRestGateway,
  IPlatformGovernanceService,
  ISessionIndex,
  ISessionRunService,
  IWorkspaceService,
  IWorkspaceArtifactService,
  resumeSessionById,
  type Scope,
} from '@spiderbyte/agent-core';
import { MiniDb } from '@spiderbyte/minidb';
import {
  collaborationChannelSchema,
  type CollaborationMessageCancelInput,
  collaborationMessageSchema,
  collaborationThreadSchema,
  type CollaborationChannel,
  type CollaborationChannelCreateInput,
  type CollaborationMessage,
  type CollaborationMessageCommandInput,
  type CollaborationMessageCommandResult,
  type CollaborationMessageCreateInput,
  type CollaborationMessagePage,
  type CollaborationMessageUpdateInput,
  type CollaborationThread,
  type CollaborationThreadCreateInput,
  type CollaborationThreadPage,
} from '@spiderbyte/protocol';
import { ulid } from 'ulid';

import {
  assertWorkspaceAuthorization,
  resolveLocalActorId,
} from './platformAuthorization';
import { ensureMainAgent } from '../transport/mainAgent';

type CollaborationErrorKind = 'workspace_not_found' | 'session_not_found' | 'not_found' | 'forbidden' | 'conflict';

export class CollaborationError extends Error {
  constructor(
    readonly kind: CollaborationErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'CollaborationError';
  }
}

interface CollaborationServiceOptions {
  readonly homeDir: string;
  readonly core: Scope;
}

interface CollaborationMessageListOptions {
  readonly afterSequence?: number;
  readonly limit?: number;
  readonly threadId?: string;
}

const DEFAULT_CHANNELS = [
  { name: 'general', description: 'Shared workspace conversation' },
  { name: 'run-monitor', description: 'Durable run and event projections' },
  { name: 'approvals', description: 'Human approval requests' },
] as const;

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;

/**
 * Durable collaboration projections for the web surface.
 *
 * This service intentionally lives in kap-server rather than in Next.js or
 * Agent Core. It owns only collaboration records and links; workspace
 * authorization, sessions, runs, artifacts, usage, and policy remain owned by
 * the existing platform services.
 */
export class CollaborationService {
  private readonly core: Scope;
  private readonly db: MiniDb;
  private mutationQueue: Promise<void> = Promise.resolve();
  private commandQueue: Promise<void> = Promise.resolve();

  private constructor(core: Scope, db: MiniDb) {
    this.core = core;
    this.db = db;
  }

  static async open(options: CollaborationServiceOptions): Promise<CollaborationService> {
    const db = await MiniDb.open({
      dir: join(options.homeDir, 'collaboration'),
      valueCodec: 'json',
      fsyncPolicy: 'everysec',
      autoCompact: true,
    });
    return new CollaborationService(options.core, db);
  }

  async close(): Promise<void> {
    await this.mutationQueue;
    await this.commandQueue;
    await this.db.close();
  }

  async listChannels(workspaceId: string, requestId: string): Promise<readonly CollaborationChannel[]> {
    const authorization = await this.authorize(workspaceId, requestId, 'data.read');
    await this.mutate(() => this.ensureDefaultChannels(workspaceId, authorization.actorId, authorization.projectId));
    const channels = this.db
      .prefix(channelPrefix(workspaceId))
      .map((entry) => collaborationChannelSchema.parse(entry.value))
      .filter((channel) => this.canAccess(channel, authorization.actorId))
      .toSorted((left, right) => left.created_at.localeCompare(right.created_at));
    return channels;
  }

  async createChannel(
    workspaceId: string,
    requestId: string,
    input: CollaborationChannelCreateInput,
  ): Promise<CollaborationChannel> {
    const authorization = await this.authorize(workspaceId, requestId, 'data.write');
    return this.mutate(async () => {
      const now = new Date().toISOString();
      const members = new Set([...(input.member_ids ?? []), authorization.actorId]);
      const channel = collaborationChannelSchema.parse({
        id: `channel_${ulid().toLowerCase()}`,
        workspace_id: workspaceId,
        project_id: authorization.projectId,
        kind: input.kind,
        name: input.name,
        description: input.description ?? '',
        state: 'active',
        member_ids: input.kind === 'public' ? [] : [...members],
        created_by: authorization.actorId,
        created_at: now,
        updated_at: now,
        last_sequence: 0,
      });
      await this.db.set(channelKey(workspaceId, channel.id), channel);
      return channel;
    });
  }

  async listThreads(workspaceId: string, channelId: string, requestId: string): Promise<CollaborationThreadPage> {
    const authorization = await this.authorize(workspaceId, requestId, 'data.read');
    const channel = await this.getAccessibleChannel(workspaceId, channelId, authorization.actorId);
    await this.mutate(() => this.ensureDefaultThread(channel, authorization.actorId));
    const items = this.db
      .prefix(threadPrefix(workspaceId))
      .map((entry) => collaborationThreadSchema.parse(entry.value))
      .filter((thread) => thread.channel_id === channel.id)
      .toSorted((left, right) => right.updated_at.localeCompare(left.updated_at));
    return { items };
  }

  async createThread(
    workspaceId: string,
    channelId: string,
    requestId: string,
    input: CollaborationThreadCreateInput,
  ): Promise<CollaborationThread> {
    const authorization = await this.authorize(workspaceId, requestId, 'data.write');
    const channel = await this.getAccessibleChannel(workspaceId, channelId, authorization.actorId);
    if (channel.state !== 'active') {
      throw new CollaborationError('conflict', 'channel is not accepting new threads');
    }
    return this.mutate(async () => {
      const now = new Date().toISOString();
      const thread = collaborationThreadSchema.parse({
        id: `thread_${ulid().toLowerCase()}`,
        workspace_id: workspaceId,
        channel_id: channel.id,
        title: input.title,
        state: 'active',
        created_by: authorization.actorId,
        created_at: now,
        updated_at: now,
        last_sequence: 0,
      });
      await this.db.set(threadKey(workspaceId, thread.id), thread);
      return thread;
    });
  }

  async listMessages(
    workspaceId: string,
    channelId: string,
    requestId: string,
    options: CollaborationMessageListOptions = {},
  ): Promise<CollaborationMessagePage> {
    const authorization = await this.authorize(workspaceId, requestId, 'data.read');
    const channel = await this.getAccessibleChannel(workspaceId, channelId, authorization.actorId);
    if (options.threadId !== undefined) {
      await this.getAccessibleThread(workspaceId, channel.id, options.threadId);
    }
    const afterSequence = options.afterSequence ?? 0;
    const limit = clampLimit(options.limit);
    const stored = this.db
      .prefix(messagePrefix(workspaceId))
      .map((entry) => collaborationMessageSchema.parse(entry.value))
      .filter((message) => message.channel_id === channel.id);
    // Reconcile linked runs before applying the cursor. A run transition can
    // revise an older collaboration message, and that revision must receive
    // a new event cursor so a connected or reconnecting client can observe it.
    const synced = await this.syncRunLinks(workspaceId, stored);
    const items = synced
      .filter((message) =>
        collaborationEventSequence(message) > afterSequence &&
        (options.threadId === undefined || message.thread_id === options.threadId),
      )
      .toSorted((left, right) => collaborationEventSequence(left) - collaborationEventSequence(right));
    const page = items.slice(0, limit);
    return {
      items: page,
      next_cursor: items.length > limit ? String(collaborationEventSequence(page.at(-1)!)) : undefined,
    };
  }

  async createMessage(
    workspaceId: string,
    channelId: string,
    requestId: string,
    input: CollaborationMessageCreateInput,
  ): Promise<CollaborationMessage> {
    assertCollaborationMetadata(input.metadata);
    const authorization = await this.authorize(workspaceId, requestId, 'data.write');
    const channel = await this.getAccessibleChannel(workspaceId, channelId, authorization.actorId);
    const thread = await this.getAccessibleThread(workspaceId, channel.id, input.thread_id);
    if (channel.state !== 'active' || thread.state !== 'active') {
      throw new CollaborationError('conflict', 'channel or thread is not accepting new messages');
    }

    return this.mutate(async () => {
      const idempotencyKeyValue = idempotencyKey(workspaceId, channel.id, input.client_message_id);
      const priorMessageId = await this.db.getAsync(idempotencyKeyValue) as string | undefined;
      if (priorMessageId !== undefined) {
        const prior = await this.db.getAsync(messageKey(workspaceId, priorMessageId));
        if (prior === undefined) {
          throw new CollaborationError('conflict', 'collaboration idempotency record is incomplete');
        }
        const parsed = collaborationMessageSchema.parse(prior);
        if (parsed.author_id !== authorization.actorId) {
          throw new CollaborationError('forbidden', 'client_message_id belongs to another actor');
        }
        if (parsed.content !== input.content || parsed.thread_id !== thread.id) {
          throw new CollaborationError('conflict', 'client_message_id was already used for different content');
        }
        return parsed;
      }

      // Keep the creation-order sequence stable when later run or artifact
      // projections revise this message. Revisions use the separate durable
      // event cursor below.
      const sequence = await this.nextMessageSequence(workspaceId);
      const eventSequence = await this.nextSequence(workspaceId);
      const now = new Date().toISOString();
      const message = collaborationMessageSchema.parse({
        id: `message_${ulid().toLowerCase()}`,
        workspace_id: workspaceId,
        channel_id: channel.id,
        thread_id: thread.id,
        sequence,
        event_sequence: eventSequence,
        author_id: authorization.actorId,
        author_kind: 'user',
        author_display_name: authorization.actorId,
        content: input.content,
        state: 'queued',
        client_message_id: input.client_message_id,
        artifact_ids: [],
        metadata: input.metadata,
        created_at: now,
        updated_at: now,
      });
      await this.db.set(messageKey(workspaceId, message.id), message);
      await this.db.set(idempotencyKeyValue, message.id);
      await this.db.set(channelKey(workspaceId, channel.id), { ...channel, last_sequence: eventSequence, updated_at: now });
      await this.db.set(threadKey(workspaceId, thread.id), { ...thread, last_sequence: eventSequence, updated_at: now });
      return message;
    });
  }

  /**
   * Atomically owns the collaboration command boundary: persist the user
   * projection, validate the session/workspace binding, dispatch through the
   * existing Agent Core gateway, and persist the run link. Retrying the same
   * client_message_id never dispatches a second prompt after a link exists.
   */
  async submitMessageCommand(
    workspaceId: string,
    channelId: string,
    requestId: string,
    input: CollaborationMessageCommandInput,
  ): Promise<CollaborationMessageCommandResult> {
    const authorization = await this.authorize(workspaceId, requestId, 'run.execute');
    const summary = await this.core.accessor.get(ISessionIndex).get(input.session_id);
    if (summary === undefined) throw new CollaborationError('session_not_found', 'session not found');
    if (summary.workspaceId !== workspaceId) {
      throw new CollaborationError('forbidden', 'session does not belong to the addressed workspace');
    }
    const channel = await this.getAccessibleChannel(workspaceId, channelId, authorization.actorId);
    return this.command(async () => {
      // Serialize the whole persistence-to-dispatch sequence. Without this
      // lock two retries arriving together could both observe a queued
      // projection and enqueue the same prompt before either writes its run
      // link.
      const existing = await this.findIdempotentMessage(workspaceId, channel.id, input.client_message_id);
      if (existing !== undefined && (
        existing.author_id !== authorization.actorId ||
        existing.content !== input.content ||
        existing.thread_id !== input.thread_id ||
        (existing.session_id !== undefined && existing.session_id !== input.session_id)
      )) {
        if (existing.author_id !== authorization.actorId) {
          throw new CollaborationError('forbidden', 'client_message_id belongs to another actor');
        }
        throw new CollaborationError('conflict', 'client_message_id was already used for a different command');
      }
      if (existing?.session_id !== undefined || existing?.run_id !== undefined) {
        return { message: existing, session_id: input.session_id, run_id: existing.run_id };
      }
      const message = existing ?? await this.createMessage(workspaceId, channel.id, requestId, {
        request_id: input.request_id,
        client_message_id: input.client_message_id,
        thread_id: input.thread_id,
        content: input.content,
        metadata: input.metadata,
      });

      try {
        const session = await resumeSessionById(this.core.accessor, input.session_id);
        if (session === undefined) throw new CollaborationError('session_not_found', 'session not found');
        await ensureMainAgent(session);
        const launched = await this.core.accessor.get(IRestGateway).prompt(input.session_id, 'main', message.content);
        const updated = await this.updateMessage(workspaceId, channel.id, message.id, requestId, {
          request_id: requestId,
          state: launched?.run_id === undefined ? 'queued' : 'running',
          session_id: input.session_id,
          run_id: launched?.run_id,
        });
        return { message: updated, session_id: input.session_id, run_id: launched?.run_id };
      } catch (error) {
        try {
          await this.updateMessage(workspaceId, channel.id, message.id, requestId, { request_id: requestId, state: 'failed' });
        } catch {
          // Preserve the original dispatch failure; REST catch-up can recover
          // the queued message if persistence itself is temporarily unavailable.
        }
        throw error;
      }
    });
  }

  /**
   * Cancel the authoritative Agent Core loop and its linked durable Run.
   *
   * The collaboration record is only a projection: it never marks a run
   * cancelled without first addressing the session gateway and Run service.
   */
  async cancelMessageCommand(
    workspaceId: string,
    channelId: string,
    messageId: string,
    requestId: string,
    input: CollaborationMessageCancelInput,
  ): Promise<CollaborationMessageCommandResult> {
    const authorization = await this.authorize(workspaceId, requestId, 'run.execute');
    const channel = await this.getAccessibleChannel(workspaceId, channelId, authorization.actorId);
    return this.command(async () => {
      const current = await this.getAccessibleMessage(workspaceId, channel.id, messageId, authorization.actorId);
      if (current.session_id === undefined) {
        throw new CollaborationError('conflict', 'collaboration message is not linked to a session');
      }
      if (current.state === 'cancelled') {
        return { message: current, session_id: current.session_id, run_id: current.run_id };
      }

      const session = await resumeSessionById(this.core.accessor, current.session_id);
      if (session === undefined) throw new CollaborationError('session_not_found', 'session not found');
      await ensureMainAgent(session);

      const runs = session.accessor.get(ISessionRunService);
      const run = current.run_id === undefined ? undefined : await runs.get(current.run_id);
      if (run !== undefined && (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled')) {
        throw new CollaborationError('conflict', `run ${run.id} is already ${run.status}`);
      }

      await this.core.accessor.get(IRestGateway).cancel(current.session_id, 'main', input.reason);
      if (run !== undefined) {
        const cancelled = await runs.cancel(run.id, { request_id: input.request_id });
        if (cancelled === undefined) throw new CollaborationError('not_found', 'linked run was not found');
      }

      const updated = await this.updateMessage(workspaceId, channel.id, current.id, requestId, {
        request_id: requestId,
        state: 'cancelled',
      });
      return { message: updated, session_id: current.session_id, run_id: current.run_id };
    });
  }

  async updateMessage(
    workspaceId: string,
    channelId: string,
    messageId: string,
    requestId: string,
    input: CollaborationMessageUpdateInput,
  ): Promise<CollaborationMessage> {
    const authorization = await this.authorize(workspaceId, requestId, 'data.write');
    assertCollaborationMetadata(input.metadata);
    const channel = await this.getAccessibleChannel(workspaceId, channelId, authorization.actorId);
    return this.mutate(async () => {
      const value = await this.db.getAsync(messageKey(workspaceId, messageId));
      if (value === undefined) {
        throw new CollaborationError('not_found', 'collaboration message not found');
      }
      const current = collaborationMessageSchema.parse(value);
      if (current.channel_id !== channel.id) {
        throw new CollaborationError('not_found', 'collaboration message not found');
      }
      if (current.author_id !== authorization.actorId) {
        throw new CollaborationError('forbidden', 'only the message author may update this projection');
      }
      await this.assertMessageLinks(workspaceId, current, input);
      const updated = collaborationMessageSchema.parse({
        ...current,
        state: input.state ?? current.state,
        session_id: input.session_id ?? current.session_id,
        run_id: input.run_id ?? current.run_id,
        attempt_id: input.attempt_id ?? current.attempt_id,
        artifact_ids: input.artifact_ids ?? current.artifact_ids,
        metadata: input.metadata ?? current.metadata,
        updated_at: new Date().toISOString(),
      });
      const eventSequence = await this.nextSequence(workspaceId);
      const revised = collaborationMessageSchema.parse({ ...updated, event_sequence: eventSequence });
      await this.db.set(messageKey(workspaceId, current.id), revised);
      await this.db.set(channelKey(workspaceId, channel.id), {
        ...channel,
        last_sequence: eventSequence,
        updated_at: revised.updated_at,
      });
      const threadValue = await this.db.getAsync(threadKey(workspaceId, current.thread_id));
      if (threadValue !== undefined) {
        const thread = collaborationThreadSchema.parse(threadValue);
        await this.db.set(threadKey(workspaceId, thread.id), {
          ...thread,
          last_sequence: eventSequence,
          updated_at: revised.updated_at,
        });
      }
      return revised;
    });
  }

  private async assertMessageLinks(
    workspaceId: string,
    current: CollaborationMessage,
    input: CollaborationMessageUpdateInput,
  ): Promise<void> {
    const sessionId = input.session_id ?? current.session_id;
    const runId = input.run_id ?? current.run_id;
    const artifactIds = input.artifact_ids ?? current.artifact_ids;
    if (sessionId === undefined && runId !== undefined) {
      throw new CollaborationError('forbidden', 'a run link requires a session link');
    }
    if (sessionId === undefined) {
      if (artifactIds.length > 0) {
        throw new CollaborationError('forbidden', 'an artifact link requires a session link');
      }
      return;
    }

    const summary = await this.core.accessor.get(ISessionIndex).get(sessionId);
    if (summary === undefined) throw new CollaborationError('session_not_found', 'session not found');
    if (summary.workspaceId !== workspaceId) {
      throw new CollaborationError('forbidden', 'session link does not belong to the addressed workspace');
    }
    const session = await resumeSessionById(this.core.accessor, sessionId);
    if (session === undefined) throw new CollaborationError('session_not_found', 'session not found');
    if (artifactIds.length > 0) {
      const artifacts = await session.accessor.get(IWorkspaceArtifactService).list();
      if (artifactIds.some((artifactId) => !artifacts.some((artifact) => artifact.id === artifactId))) {
        throw new CollaborationError('forbidden', 'artifact link does not belong to the addressed workspace');
      }
    }
    if (runId === undefined) return;

    const run = await session.accessor.get(ISessionRunService).get(runId);
    if (run === undefined || run.workspace_id !== workspaceId || run.agent_session_id !== sessionId) {
      throw new CollaborationError('forbidden', 'run link does not belong to the addressed session and workspace');
    }
  }

  private async authorize(
    workspaceId: string,
    requestId: string,
    capability: 'data.read' | 'data.write' | 'run.execute',
  ): Promise<{ readonly actorId: string; readonly projectId?: string }> {
    const workspace = await this.core.accessor.get(IWorkspaceService).get(workspaceId);
    if (workspace === undefined) throw new CollaborationError('workspace_not_found', 'workspace not found');
    await assertWorkspaceAuthorization(this.core, { workspaceId, requestId, capability });
    const project = await this.core.accessor.get(IPlatformGovernanceService).projectForWorkspace(workspaceId);
    return { actorId: resolveLocalActorId(), projectId: project?.id };
  }

  private async findIdempotentMessage(
    workspaceId: string,
    channelId: string,
    clientMessageId: string,
  ): Promise<CollaborationMessage | undefined> {
    const priorMessageId = await this.db.getAsync(idempotencyKey(workspaceId, channelId, clientMessageId)) as string | undefined;
    if (priorMessageId === undefined) return undefined;
    const value = await this.db.getAsync(messageKey(workspaceId, priorMessageId));
    if (value === undefined) throw new CollaborationError('conflict', 'collaboration idempotency record is incomplete');
    return collaborationMessageSchema.parse(value);
  }

  /**
   * Reconcile linked collaboration projections from the authoritative Run
   * service before returning a page. This is deliberately a read-side
   * projection: it never creates, advances, or retries a Run.
   */
  private async syncRunLinks(
    workspaceId: string,
    messages: readonly CollaborationMessage[],
  ): Promise<CollaborationMessage[]> {
    const sessionIds = new Set(
      messages.flatMap((message) => message.session_id === undefined ? [] : [message.session_id]),
    );
    if (sessionIds.size === 0) return [...messages];

    const runs = new Map<string, Awaited<ReturnType<ISessionRunService['list']>>[number]>();
    for (const sessionId of sessionIds) {
      try {
        const session = await resumeSessionById(this.core.accessor, sessionId);
        if (session === undefined) continue;
        for (const run of await session.accessor.get(ISessionRunService).list()) runs.set(run.id, run);
      } catch {
        // A cold or concurrently closing session should not make a durable
        // collaboration page unreadable; REST can catch it up on the next
        // poll after the session is available again.
      }
    }
    if (runs.size === 0) return [...messages];

    return this.mutate(async () => {
      const synced: CollaborationMessage[] = [];
      for (const message of messages) {
        if (message.run_id === undefined) {
          synced.push(message);
          continue;
        }
        const run = runs.get(message.run_id);
        if (run === undefined) {
          synced.push(message);
          continue;
        }
        const state = collaborationStateForRun(run.status);
        const artifactIds = [
          ...(run.output_artifacts?.map((artifact) => artifact.id) ?? []),
        ];
        const currentValue = await this.db.getAsync(messageKey(workspaceId, message.id));
        const current = currentValue === undefined ? message : collaborationMessageSchema.parse(currentValue);
        const nextArtifactIds = artifactIds.length === 0 ? current.artifact_ids : artifactIds;
        const stateChanged = current.state !== state;
        const artifactsChanged = current.artifact_ids.join(',') !== nextArtifactIds.join(',');
        const updated = collaborationMessageSchema.parse({
          ...current,
          state,
          artifact_ids: nextArtifactIds,
          updated_at: stateChanged || artifactsChanged ? new Date().toISOString() : current.updated_at,
        });
        if (stateChanged || artifactsChanged) {
          const eventSequence = await this.nextSequence(workspaceId);
          const revised = collaborationMessageSchema.parse({ ...updated, event_sequence: eventSequence });
          await this.db.set(messageKey(workspaceId, message.id), revised);
          const channelValue = await this.db.getAsync(channelKey(workspaceId, message.channel_id));
          if (channelValue !== undefined) {
            const channel = collaborationChannelSchema.parse(channelValue);
            await this.db.set(channelKey(workspaceId, channel.id), {
              ...channel,
              last_sequence: eventSequence,
              updated_at: revised.updated_at,
            });
          }
          const threadValue = await this.db.getAsync(threadKey(workspaceId, message.thread_id));
          if (threadValue !== undefined) {
            const thread = collaborationThreadSchema.parse(threadValue);
            await this.db.set(threadKey(workspaceId, thread.id), {
              ...thread,
              last_sequence: eventSequence,
              updated_at: revised.updated_at,
            });
          }
          synced.push(revised);
          continue;
        }
        synced.push(updated);
      }
      return synced;
    });
  }

  private async getAccessibleChannel(
    workspaceId: string,
    channelId: string,
    actorId: string,
  ): Promise<CollaborationChannel> {
    const value = await this.db.getAsync(channelKey(workspaceId, channelId));
    if (value === undefined) throw new CollaborationError('not_found', 'collaboration channel not found');
    const channel = collaborationChannelSchema.parse(value);
    if (!this.canAccess(channel, actorId)) {
      throw new CollaborationError('forbidden', 'actor cannot access this collaboration channel');
    }
    return channel;
  }

  private async getAccessibleMessage(
    workspaceId: string,
    channelId: string,
    messageId: string,
    actorId: string,
  ): Promise<CollaborationMessage> {
    const value = await this.db.getAsync(messageKey(workspaceId, messageId));
    if (value === undefined) throw new CollaborationError('not_found', 'collaboration message not found');
    const message = collaborationMessageSchema.parse(value);
    if (message.channel_id !== channelId) throw new CollaborationError('not_found', 'collaboration message not found');
    const channel = await this.getAccessibleChannel(workspaceId, channelId, actorId);
    if (channel.id !== message.channel_id) throw new CollaborationError('not_found', 'collaboration message not found');
    if (message.author_id !== actorId) {
      throw new CollaborationError('forbidden', 'only the message author may control this run');
    }
    return message;
  }

  private async getAccessibleThread(
    workspaceId: string,
    channelId: string,
    threadId: string,
  ): Promise<CollaborationThread> {
    const value = await this.db.getAsync(threadKey(workspaceId, threadId));
    if (value === undefined) throw new CollaborationError('not_found', 'collaboration thread not found');
    const thread = collaborationThreadSchema.parse(value);
    if (thread.channel_id !== channelId) {
      throw new CollaborationError('not_found', 'collaboration thread not found');
    }
    return thread;
  }

  private canAccess(channel: CollaborationChannel, actorId: string): boolean {
    return channel.kind === 'public' || channel.member_ids.includes(actorId);
  }

  private async ensureDefaultChannels(
    workspaceId: string,
    actorId: string,
    projectId: string | undefined,
  ): Promise<void> {
    const existing = new Set(
      this.db
        .prefix(channelPrefix(workspaceId))
        .map((entry) => collaborationChannelSchema.parse(entry.value).name),
    );
    for (const definition of DEFAULT_CHANNELS) {
      if (existing.has(definition.name)) continue;
      const now = new Date().toISOString();
      const channel = collaborationChannelSchema.parse({
        id: defaultChannelId(workspaceId, definition.name),
        workspace_id: workspaceId,
        project_id: projectId,
        kind: 'public',
        name: definition.name,
        description: definition.description,
        state: 'active',
        member_ids: [],
        created_by: actorId,
        created_at: now,
        updated_at: now,
        last_sequence: 0,
      });
      await this.db.set(channelKey(workspaceId, channel.id), channel);
    }
  }

  private async ensureDefaultThread(channel: CollaborationChannel, actorId: string): Promise<void> {
    const id = defaultThreadId(channel.id);
    if ((await this.db.getAsync(threadKey(channel.workspace_id, id))) !== undefined) return;
    const now = new Date().toISOString();
    const thread = collaborationThreadSchema.parse({
      id,
      workspace_id: channel.workspace_id,
      channel_id: channel.id,
      title: `${channel.name} thread`,
      state: 'active',
      created_by: actorId,
      created_at: now,
      updated_at: now,
      last_sequence: 0,
    });
    await this.db.set(threadKey(channel.workspace_id, id), thread);
  }

  private async nextSequence(workspaceId: string): Promise<number> {
    const key = sequenceKey(workspaceId);
    const current = await this.db.getAsync(key);
    const sequence = typeof current === 'number' && Number.isSafeInteger(current) ? current + 1 : 1;
    await this.db.set(key, sequence);
    return sequence;
  }

  private async nextMessageSequence(workspaceId: string): Promise<number> {
    const key = messageSequenceKey(workspaceId);
    const current = await this.db.getAsync(key);
    if (typeof current === 'number' && Number.isSafeInteger(current)) {
      const sequence = current + 1;
      await this.db.set(key, sequence);
      return sequence;
    }

    // Migrate stores written before event_sequence was introduced without
    // allowing revision events to consume creation-order numbers.
    const highest = this.db
      .prefix(messagePrefix(workspaceId))
      .reduce((max, entry) => {
        const message = collaborationMessageSchema.parse(entry.value);
        return Math.max(max, message.sequence);
      }, 0);
    const sequence = highest + 1;
    await this.db.set(key, sequence);
    return sequence;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation);
    this.mutationQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private command<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.commandQueue.then(operation, operation);
    this.commandQueue = next.then(() => undefined, () => undefined);
    return next;
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_MESSAGE_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_MESSAGE_LIMIT);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function workspaceHash(workspaceId: string): string {
  return hash(workspaceId).slice(0, 64);
}

function idHash(id: string): string {
  return hash(id).slice(0, 32);
}

function channelPrefix(workspaceId: string): string {
  return `channel:${workspaceHash(workspaceId)}:`;
}

function channelKey(workspaceId: string, channelId: string): string {
  return `${channelPrefix(workspaceId)}${idHash(channelId)}`;
}

function threadPrefix(workspaceId: string): string {
  return `thread:${workspaceHash(workspaceId)}:`;
}

function threadKey(workspaceId: string, threadId: string): string {
  return `${threadPrefix(workspaceId)}${idHash(threadId)}`;
}

function messagePrefix(workspaceId: string): string {
  return `message:${workspaceHash(workspaceId)}:`;
}

function messageKey(workspaceId: string, messageId: string): string {
  return `${messagePrefix(workspaceId)}${idHash(messageId)}`;
}

function idempotencyKey(workspaceId: string, channelId: string, clientMessageId: string): string {
  return `idempotency:${workspaceHash(workspaceId)}:${idHash(`${channelId}:${clientMessageId}`)}`;
}

function sequenceKey(workspaceId: string): string {
  return `sequence:${workspaceHash(workspaceId)}`;
}

function messageSequenceKey(workspaceId: string): string {
  return `message-sequence:${workspaceHash(workspaceId)}`;
}

function defaultChannelId(workspaceId: string, name: string): string {
  return `channel_${idHash(`${workspaceId}:${name}`)}`;
}

function defaultThreadId(channelId: string): string {
  return `thread_${idHash(`${channelId}:main`)}`;
}

function collaborationStateForRun(status: string): CollaborationMessage['state'] {
  switch (status) {
    case 'queued': return 'queued';
    case 'planning':
    case 'running': return 'running';
    case 'awaiting_approval': return 'waiting';
    case 'cancelled': return 'cancelled';
    case 'failed': return 'failed';
    case 'succeeded': return 'completed';
    default: return 'queued';
  }
}

function collaborationEventSequence(message: CollaborationMessage): number {
  return message.event_sequence ?? message.sequence;
}

function assertCollaborationMetadata(metadata: Record<string, unknown> | undefined): void {
  if (metadata === undefined) return;
  const sensitive = /(?:api.?key|access.?token|refresh.?token|id.?token|password|private.?key|authorization|credential(?!_ref)|secret(?!_ref)|cookie)/iu;
  for (const [key, value] of Object.entries(metadata)) {
    if (sensitive.test(key)) {
      throw new CollaborationError('forbidden', `sensitive collaboration metadata key is not allowed: ${key}`);
    }
    if (typeof value === 'string' && !/^secret_[A-Za-z0-9._:-]+$/u.test(value) && sensitive.test(value)) {
      throw new CollaborationError('forbidden', `sensitive collaboration metadata value is not allowed: ${key}`);
    }
  }
}
