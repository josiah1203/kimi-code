import type { UsageStatus } from '#/rpc';
import { type TokenUsage } from '@spiderbyte/kosong';
import type { Agent } from '..';
export type UsageRecordScope = 'session' | 'turn';
export declare class UsageRecorder {
    protected readonly agent?: Agent | undefined;
    private readonly byModel;
    private currentTurn;
    constructor(agent?: Agent | undefined);
    beginTurn(): void;
    endTurn(): void;
    record(model: string, usage: TokenUsage, scope?: UsageRecordScope): void;
    data(): UsageStatus;
    status(): UsageStatus | undefined;
    private byModelSnapshot;
}
