/**
 * `SkillService` — implementation of `ISkillService`.
 */
import { Disposable } from '../../di';
import type { SkillDescriptor } from '@spiderbyte/protocol';
import { ICoreProcessService } from '../coreProcess/coreProcess';
import { ISkillService } from './skill';
export declare class SkillService extends Disposable implements ISkillService {
    private readonly core;
    readonly _serviceBrand: undefined;
    constructor(core: ICoreProcessService);
    list(sessionId: string): Promise<readonly SkillDescriptor[]>;
    listForWorkDir(workDir: string): Promise<readonly SkillDescriptor[]>;
    activate(sessionId: string, skillName: string, args?: string): Promise<void>;
    /**
     * Validate the session exists, then make sure it is loaded into the active
     * session map (idempotent when already loaded) so the SessionAPI dispatch
     * below cannot miss after a daemon restart. Same pattern as
     * `PromptService.submit` / `SessionService.undo`.
     */
    private _requireLoadedSession;
}
