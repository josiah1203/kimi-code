/**
 * `ToolService` — implementation of `IToolService`.
 */
import { Disposable } from '../../di';
import { ICoreProcessService } from '../coreProcess/coreProcess';
import { IToolService } from './tool';
export declare class ToolService extends Disposable implements IToolService {
    private readonly core;
    readonly _serviceBrand: undefined;
    constructor(core: ICoreProcessService);
    list(sessionId?: string): Promise<readonly import('@spiderbyte/protocol').ToolDescriptor[]>;
    /**
     * Find a usable session id when caller hasn't supplied one. Returns the
     * most recently created session id, or `undefined` when no sessions exist.
     */
    private _anyKnownSessionId;
}
