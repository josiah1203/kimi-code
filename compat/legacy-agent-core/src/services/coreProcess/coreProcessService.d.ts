/**
 * `CoreProcessService` — implementation of `ICoreProcessService`.
 */
import type { ImageLimits } from '../../tools/support/image-limits';
import { Disposable } from '../../di';
import type { CoreRPC } from '../../rpc';
import type { OAuthTokenProviderResolver } from '../../session/provider-manager';
import { type TelemetryClient } from '../../telemetry';
import { type KimiHostIdentity } from '@spiderbyte/oauth';
import { IApprovalService } from '../approval/approval';
import { IEnvironmentService } from '../environment/environment';
import { IEventService } from '../event/event';
import { ILogService } from '../logger/logger';
import { IQuestionService } from '../question/question';
import { IWorkspaceRegistry } from '../workspace/workspaceRegistry';
import { ICoreProcessService, type CoreProcessServiceOptions } from './coreProcess';
export declare class CoreProcessService extends Disposable implements ICoreProcessService {
    readonly _serviceBrand: undefined;
    /**
     * Service-facing RPC handle. This is a `Proxy` over the awaited
     * `RPCMethods<CoreAPI>` so callers don't have to await a promise themselves
     * — `core.rpc.createSession({...})` returns a `Promise<SessionSummary>`
     * directly. After dispose, the proxy rejects on every method invocation.
     */
    readonly rpc: CoreRPC;
    readonly kimiRequestHeaders: Record<string, string> | undefined;
    readonly telemetry: TelemetryClient;
    /** The core's owner-scoped [image] limits; see ICoreProcessService. */
    get imageLimits(): ImageLimits;
    /**
     * The in-process `KimiCore` instance. Kept private so daemon-side code can't
     * grab it and bypass the peer-service indirection.
     */
    private readonly _core;
    /**
     * Promise that resolves to the resolved RPC methods. The `rpc` proxy awaits
     * this on every dispatch (cheap — controlled-promise resolves synchronously
     * on the second call).
     */
    private readonly _coreRpcPromise;
    /**
     * Cached readiness signal. We treat "SDK-side RPC bound" as the readiness
     * marker today; once `KimiCore.pluginsReady` is publicly exposed we can
     * combine them here.
     */
    private readonly _ready;
    constructor(options: CoreProcessServiceOptions, env: IEnvironmentService, eventService: IEventService, approvalService: IApprovalService, questionService: IQuestionService, logService: ILogService, workspaceRegistry: IWorkspaceRegistry);
    ready(): Promise<void>;
    dispose(): void;
    private _buildRpcProxy;
    /**
     * Build the default `resolveOAuthTokenProvider` from the same home + config
     * paths KimiCore resolves internally. Mirrors `SDKRpcClient`'s default in
     * `packages/sdk/src/sdk-rpc-client.ts` so the daemon and the SDK
     * runtimes share OAuth credentials when both run against the same
     * `~/.kimi-code`.
     *
     * `identity` is forwarded to the managed auth facade so token refreshes
     * carry the same `X-Msh-*` device headers as `_defaultKimiRequestHeaders`.
     *
     * Exposed as `static` so tests can assert the wiring without exercising the
     * full agent-core turn loop.
     */
    static _defaultOAuthTokenResolver(homeDir: string, configPath: string, identity?: KimiHostIdentity): OAuthTokenProviderResolver;
    /**
     * Build the default `kimiRequestHeaders` from `options.identity` so the
     * outbound `User-Agent` + device-identity headers identify this process
     * as a real Coding Agent host (e.g. `kimi-code-cli/<ver>`). Without
     * these, the managed Kimi-for-Coding endpoint rejects with 40340.
     *
     * Returns `undefined` when no identity is provided — preserves the
     * pre-fix contract for hosts that pass headers explicitly via
     * `options.kimiRequestHeaders` (or for legacy callers / tests that
     * don't talk to the managed endpoint at all).
     *
     * `homeDir` resolution matches KimiCore's so the per-device id (minted
     * + cached at `<homeDir>/device_id` on first call) lives in the same
     * root as everything else KimiCore touches.
     *
     * Exposed as `static` so tests can assert the wiring without booting
     * the service.
     */
    static _defaultKimiRequestHeaders(homeDir: string, identity?: KimiHostIdentity): Record<string, string> | undefined;
}
