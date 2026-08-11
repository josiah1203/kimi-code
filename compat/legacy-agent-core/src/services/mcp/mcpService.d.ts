/**
 * `McpService` — implementation of `IMcpService`.
 */
import { Disposable } from '../../di';
import type { McpServer } from '@spiderbyte/protocol';
import { ICoreProcessService } from '../coreProcess/coreProcess';
import { IMcpService } from './mcp';
export declare class McpService extends Disposable implements IMcpService {
    private readonly core;
    readonly _serviceBrand: undefined;
    constructor(core: ICoreProcessService);
    list(): Promise<readonly McpServer[]>;
    restart(serverId: string): Promise<{
        restarting: true;
    }>;
    /**
     * Find a usable session id for dispatching SessionAPI calls. Returns the
     * most recently created session id, or `undefined` when no sessions exist.
     */
    private _anyKnownSessionId;
}
