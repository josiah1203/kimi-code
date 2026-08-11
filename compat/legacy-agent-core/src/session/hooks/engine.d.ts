import type { HookBlockDecision, HookDef, HookEngineOptions, HookEngineTriggerArgs, HookResult } from './types';
export declare class HookEngine {
    private readonly options;
    private readonly byEvent;
    private readonly pendingTriggers;
    constructor(hooks?: readonly HookDef[], options?: HookEngineOptions);
    get summary(): Record<string, number>;
    trigger(event: string, args?: HookEngineTriggerArgs): Promise<HookResult[]>;
    triggerBlock(event: string, args?: HookEngineTriggerArgs): Promise<HookBlockDecision | undefined>;
    fireAndForgetTrigger(event: string, args?: HookEngineTriggerArgs): Promise<HookResult[]>;
    private triggerInner;
    private matchingHooks;
    private emitTriggered;
    private emitResolved;
}
