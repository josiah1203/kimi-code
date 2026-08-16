// Generated from wrangler.jsonc's bindings. Re-run `pnpm types` after changing
// the Worker configuration; this checked-in declaration keeps package
// typechecking deterministic in a clean checkout.
import type { RunEventsDurableObject } from './src/events';
import type { RunOrchestrationParams } from './src/workflow';

declare global {
  interface Env {
    readonly HYPERDRIVE: Hyperdrive;
    readonly ARTIFACTS: R2Bucket;
    readonly EVENTS_QUEUE: Queue<unknown>;
    readonly DISPATCH_QUEUE: Queue<Readonly<Record<string, unknown>>>;
    readonly RUN_EVENTS: DurableObjectNamespace<RunEventsDurableObject>;
    readonly RUN_ORCHESTRATION: Workflow<RunOrchestrationParams>;
    readonly SPIDERBYTE_ENVIRONMENT: string;
    readonly SPIDERBYTE_COMMERCIAL_ACCOUNT_ID?: string;
    readonly SPIDERBYTE_PLATFORM_SYNC_URL?: string;
    readonly SPIDERBYTE_PLATFORM_SYNC_TOKEN?: string;
    readonly SPIDERBYTE_PLATFORM_SYNC_SECRET?: string;
    readonly SPIDERBYTE_REQUIRE_PLATFORM_IDENTITY_BINDING?: string;
    readonly SPIDERBYTE_PLATFORM_PROJECT_WORKSPACE_BINDINGS_JSON?: string;
    readonly CLERK_SECRET_KEY?: string;
    readonly CLERK_JWT_KEY?: string;
    readonly CLERK_AUTHORIZED_PARTIES?: string;
    readonly OPENROUTER_AI_GATEWAY_ENDPOINT?: string;
    readonly OPENROUTER_API_KEY?: string;
    readonly ARTIFACT_DOWNLOAD_SIGNING_SECRET?: string;
    readonly SPIDERBYTE_PUBLIC_ORIGIN?: string;
  }
}

export {};
