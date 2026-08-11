/** Stable `/api/v2/sessions/:session_id/runs` surface for durable platform Runs. */

import {
  IFlagService,
  ISessionRunService,
  resumeSessionById,
  type Scope,
} from '@spiderbyte/agent-core';
import {
  runActionInputSchema,
  runCreateInputSchema,
  runForkInputSchema,
  runIdSchema,
  runTransitionInputSchema,
} from '@spiderbyte/protocol';
import { z } from 'zod';

import { errEnvelope, okEnvelope } from '../../protocol/envelope';
import { ErrorCode } from '../../protocol/error-codes';
import { validationEnvelope } from '../../transport/errors';
import { mapPlatformError } from './platformErrors';

interface RunRouteHost {
  get(path: string, options: { preHandler: unknown[] }, handler: RunHandler): unknown;
  post(path: string, options: { preHandler: unknown[] }, handler: RunHandler): unknown;
}

interface RunRequest {
  readonly id: string;
  readonly params: unknown;
  readonly body: unknown;
}

interface RunReply {
  send(payload: unknown): unknown;
}

type RunHandler = (req: RunRequest, reply: RunReply) => Promise<void>;

const paramsSchema = z.object({ session_id: z.string().min(1) });
const runParamsSchema = paramsSchema.extend({ run_id: runIdSchema });

export function registerRunRoutes(app: RunRouteHost, core: Scope): void {
  const opts = { preHandler: [] };
  app.get('/sessions/:session_id/runs', opts, async (req, reply) => {
    await sessionRequest(req, reply, core, paramsSchema, async (runs) => runs.list());
  });
  app.get('/sessions/:session_id/runs/:run_id', opts, async (req, reply) => {
    await sessionRequest(req, reply, core, runParamsSchema, async (runs, params) =>
      runs.get(params.run_id),
    );
  });
  app.post('/sessions/:session_id/runs', opts, async (req, reply) => {
    await sessionRequest(req, reply, core, paramsSchema, async (runs) =>
      runs.create(runCreateInputSchema.parse(req.body)),
    );
  });
  app.post('/sessions/:session_id/runs/:run_id/transition', opts, async (req, reply) => {
    await sessionRequest(req, reply, core, runParamsSchema, async (runs, params) =>
      runs.transition(params.run_id, runTransitionInputSchema.parse(req.body)),
    );
  });
  for (const action of ['cancel', 'resume', 'retry', 'rerun'] as const) {
    app.post(`/sessions/:session_id/runs/:run_id/${action}`, opts, async (req, reply) => {
      await sessionRequest(req, reply, core, runParamsSchema, async (runs, params) => {
        const input = runActionInputSchema.parse(req.body);
        return action === 'cancel'
          ? runs.cancel(params.run_id, input)
          : action === 'resume'
            ? runs.resume(params.run_id, input)
            : action === 'retry'
            ? runs.retry(params.run_id, input)
            : runs.rerun(params.run_id, input);
      });
    });
  }
  app.post('/sessions/:session_id/runs/:run_id/fork', opts, async (req, reply) => {
    await sessionRequest(req, reply, core, runParamsSchema, async (runs, params) =>
      runs.fork(params.run_id, runForkInputSchema.parse(req.body)),
    );
  });
}

async function sessionRequest<TParams extends z.ZodTypeAny>(
  req: RunRequest,
  reply: RunReply,
  core: Scope,
  schema: TParams,
  operation: (
    runs: ISessionRunService,
    params: z.infer<TParams>,
  ) => Promise<unknown>,
): Promise<void> {
  if (!core.accessor.get(IFlagService).enabled('platform_services')) {
    reply.send(errEnvelope(ErrorCode.PLATFORM_DISABLED, 'platform services are disabled', req.id));
    return;
  }
  try {
    const params = schema.parse(req.params);
    const session = await resumeSessionById(core.accessor, (params as { session_id: string }).session_id);
    if (session === undefined) {
      reply.send(errEnvelope(ErrorCode.SESSION_NOT_FOUND, 'session not found', req.id));
      return;
    }
    const data = await operation(session.accessor.get(ISessionRunService), params);
    if (data === undefined) {
      reply.send(errEnvelope(ErrorCode.PLATFORM_RESOURCE_NOT_FOUND, 'platform resource not found', req.id));
      return;
    }
    reply.send(okEnvelope(data, req.id));
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
    reply.send(mapPlatformError(error, req.id));
  }
}
