import type { AgentReplayRecord } from '../../rpc/resumed';
import type { AgentRecordPersistence } from '../records';
import type { ReplayRangeOptions } from '.';
export declare function buildReplay(persistence: AgentRecordPersistence, range?: ReplayRangeOptions): Promise<readonly AgentReplayRecord[]>;
