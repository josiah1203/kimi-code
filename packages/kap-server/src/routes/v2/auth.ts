/** Accountless identity status for the Open Core v2 surface. */

import { z } from 'zod';

import { defineRoute } from '../../middleware/defineRoute';
import { okEnvelope } from '../../protocol/envelope';

interface V2AuthRouteHost {
  get(
    path: string,
    options: { schema?: Record<string, unknown> } | undefined,
    handler: (
      req: { id: string },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
}

export const localAuthStatusSchema = z.strictObject({
  mode: z.literal('local'),
  authenticated: z.literal(false),
  credential_class: z.literal('account'),
});

export function registerV2AuthRoutes(app: V2AuthRouteHost): void {
  const route = defineRoute(
    {
      method: 'GET',
      path: '/auth/status',
      success: { data: localAuthStatusSchema },
      description: 'Get the accountless Open Core identity mode',
      tags: ['auth'],
    },
    (req, reply) => {
      reply.send(okEnvelope({
        mode: 'local',
        authenticated: false,
        credential_class: 'account',
      }, req.id));
    },
  );
  app.get(route.path, route.options, route.handler as Parameters<V2AuthRouteHost['get']>[2]);
}
