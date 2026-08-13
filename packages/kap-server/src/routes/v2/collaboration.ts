import { IFlagService, isError2, type Scope } from '@spiderbyte/agent-core';
import {
  collaborationChannelCreateInputSchema,
  collaborationMessageCancelInputSchema,
  collaborationMessageCommandInputSchema,
  collaborationMessageCreateInputSchema,
  collaborationMessageUpdateInputSchema,
  collaborationThreadCreateInputSchema,
} from '@spiderbyte/protocol';
import { z } from 'zod';

import { errEnvelope, okEnvelope } from '../../protocol/envelope';
import { ErrorCode } from '../../protocol/error-codes';
import { validationEnvelope } from '../../transport/errors';
import { CollaborationError, CollaborationService } from '../../services/collaborationService';
import { mapPlatformError } from './platformErrors';

interface CollaborationRouteHost {
  get(path: string, options: { preHandler: unknown[] }, handler: CollaborationHandler): unknown;
  post(path: string, options: { preHandler: unknown[] }, handler: CollaborationHandler): unknown;
  patch(path: string, options: { preHandler: unknown[] }, handler: CollaborationHandler): unknown;
}

interface CollaborationRequest {
  readonly id: string;
  readonly params: unknown;
  readonly query: unknown;
  readonly body: unknown;
}

interface CollaborationReply {
  send(payload: unknown): unknown;
}

type CollaborationHandler = (req: CollaborationRequest, reply: CollaborationReply) => Promise<void>;

const workspaceParamsSchema = z.object({ workspace_id: z.string().min(1) });
const channelParamsSchema = workspaceParamsSchema.extend({ channel_id: z.string().min(1) });
const messageParamsSchema = channelParamsSchema.extend({ message_id: z.string().min(1) });
const messageQuerySchema = z.object({
  after_sequence: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  thread_id: z.string().min(1).optional(),
});

export function registerCollaborationRoutes(
  app: CollaborationRouteHost,
  core: Scope,
  collaboration: CollaborationService,
): void {
  const opts = { preHandler: [] };

  app.get('/workspaces/:workspace_id/collaboration/channels', opts, async (req, reply) => {
    await request(req, reply, core, async () =>
      collaboration.listChannels(workspaceParamsSchema.parse(req.params).workspace_id, req.id),
    );
  });

  app.post('/workspaces/:workspace_id/collaboration/channels', opts, async (req, reply) => {
    await request(req, reply, core, async () => {
      const params = workspaceParamsSchema.parse(req.params);
      return collaboration.createChannel(
        params.workspace_id,
        req.id,
        collaborationChannelCreateInputSchema.parse(req.body),
      );
    });
  });

  app.get('/workspaces/:workspace_id/collaboration/channels/:channel_id/threads', opts, async (req, reply) => {
    await request(req, reply, core, async () => {
      const params = channelParamsSchema.parse(req.params);
      return collaboration.listThreads(params.workspace_id, params.channel_id, req.id);
    });
  });

  app.post('/workspaces/:workspace_id/collaboration/channels/:channel_id/threads', opts, async (req, reply) => {
    await request(req, reply, core, async () => {
      const params = channelParamsSchema.parse(req.params);
      return collaboration.createThread(
        params.workspace_id,
        params.channel_id,
        req.id,
        collaborationThreadCreateInputSchema.parse(req.body),
      );
    });
  });

  app.get('/workspaces/:workspace_id/collaboration/channels/:channel_id/messages', opts, async (req, reply) => {
    await request(req, reply, core, async () => {
      const params = channelParamsSchema.parse(req.params);
      const query = messageQuerySchema.parse(req.query ?? {});
      return collaboration.listMessages(params.workspace_id, params.channel_id, req.id, {
        afterSequence: query.after_sequence,
        limit: query.limit,
        threadId: query.thread_id,
      });
    });
  });

  app.post('/workspaces/:workspace_id/collaboration/channels/:channel_id/messages', opts, async (req, reply) => {
    await request(req, reply, core, async () => {
      const params = channelParamsSchema.parse(req.params);
      return collaboration.createMessage(
        params.workspace_id,
        params.channel_id,
        req.id,
        collaborationMessageCreateInputSchema.parse(req.body),
      );
    });
  });

  app.post('/workspaces/:workspace_id/collaboration/channels/:channel_id/messages/command', opts, async (req, reply) => {
    await request(req, reply, core, async () => {
      const params = channelParamsSchema.parse(req.params);
      return collaboration.submitMessageCommand(
        params.workspace_id,
        params.channel_id,
        req.id,
        collaborationMessageCommandInputSchema.parse(req.body),
      );
    });
  });

  app.post('/workspaces/:workspace_id/collaboration/channels/:channel_id/messages/:message_id/cancel', opts, async (req, reply) => {
    await request(req, reply, core, async () => {
      const params = messageParamsSchema.parse(req.params);
      return collaboration.cancelMessageCommand(
        params.workspace_id,
        params.channel_id,
        params.message_id,
        req.id,
        collaborationMessageCancelInputSchema.parse(req.body),
      );
    });
  });

  app.patch('/workspaces/:workspace_id/collaboration/channels/:channel_id/messages/:message_id', opts, async (req, reply) => {
    await request(req, reply, core, async () => {
      const params = messageParamsSchema.parse(req.params);
      return collaboration.updateMessage(
        params.workspace_id,
        params.channel_id,
        params.message_id,
        req.id,
        collaborationMessageUpdateInputSchema.parse(req.body),
      );
    });
  });
}

async function request(
  req: CollaborationRequest,
  reply: CollaborationReply,
  core: Scope,
  operation: () => Promise<unknown>,
): Promise<void> {
  if (!core.accessor.get(IFlagService).enabled('platform_services')) {
    reply.send(errEnvelope(ErrorCode.PLATFORM_DISABLED, 'platform services are disabled', req.id));
    return;
  }
  try {
    reply.send(okEnvelope(await operation(), req.id));
  } catch (error) {
    if (error instanceof z.ZodError) {
      reply.send(
        validationEnvelope(
          error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
          req.id,
        ),
      );
      return;
    }
    if (error instanceof CollaborationError) {
      const code = error.kind === 'workspace_not_found'
        ? ErrorCode.WORKSPACE_NOT_FOUND
        : error.kind === 'session_not_found'
          ? ErrorCode.SESSION_NOT_FOUND
        : error.kind === 'not_found'
        ? ErrorCode.PLATFORM_RESOURCE_NOT_FOUND
        : error.kind === 'forbidden'
          ? ErrorCode.PLATFORM_POLICY_DENIED
          : ErrorCode.PLATFORM_CONFLICT;
      reply.send(errEnvelope(code, error.message, req.id));
      return;
    }
    if (isError2(error)) {
      reply.send(mapPlatformError(error, req.id));
      return;
    }
    reply.send(errEnvelope(ErrorCode.INTERNAL_ERROR, 'collaboration request failed', req.id));
  }
}
