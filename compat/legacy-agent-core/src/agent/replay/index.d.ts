import type { Agent } from '..';
import type { AgentReplayRecord, AgentReplayRecordPayload } from '../../rpc/resumed';
import type { ContextMessage } from '../context';
export interface ReplayRangeOptions {
    readonly start?: number;
    readonly count?: number;
}
export interface ReplayBuilderOptions {
    readonly range?: ReplayRangeOptions;
}
export declare class ReplayBuilder {
    readonly agent: Agent;
    private readonly options;
    postRestoring: boolean;
    captureLiveRecords: boolean;
    protected readonly records: AgentReplayRecord[];
    private frozen;
    private segmentStart;
    constructor(agent: Agent, options?: ReplayBuilderOptions);
    push(record: AgentReplayRecordPayload): void;
    patchLast<T extends AgentReplayRecord['type']>(type: T, patch: Partial<Extract<AgentReplayRecord, {
        type: T;
    }>>): void;
    removeLastMessages(removedMessages: ReadonlySet<ContextMessage>): void;
    finishRestoringRecord(type: string): boolean;
    buildResult(): readonly AgentReplayRecord[];
    private removeMessagesFrom;
}
