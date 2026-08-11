/**
 * `/api/v2` route registration.
 *
 * The v2 surface shares v1's wire conventions: every response is wrapped in
 * the `{ code, msg, data, request_id }` envelope with the business outcome in
 * `code`, and the HTTP status only reports server-/transport-level outcomes
 * (the global bearer-auth hook covers `/api/v2/*` exactly like `/api/v1/*`
 * and answers 401 before routing).
 */

import type { Scope } from '@spiderbyte/agent-core';

import { registerV2SessionsRoutes } from './v2/sessions';
import { registerPlatformRoutes } from './v2/platform';
import { registerRunRoutes } from './v2/runs';

interface ApiV2AppHost {
  register(
    plugin: (apiV2: unknown) => Promise<void> | void,
    opts: { prefix: string },
  ): unknown;
}

export async function registerApiV2Routes(app: ApiV2AppHost, core: Scope): Promise<void> {
  await app.register(
    async (apiV2) => {
      registerV2SessionsRoutes(apiV2 as Parameters<typeof registerV2SessionsRoutes>[0], core);
      registerRunRoutes(apiV2 as Parameters<typeof registerRunRoutes>[0], core);
      registerPlatformRoutes(apiV2 as Parameters<typeof registerPlatformRoutes>[0], core);
    },
    { prefix: '/api/v2' },
  );
}
