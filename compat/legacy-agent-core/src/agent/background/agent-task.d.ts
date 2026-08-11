import { type BackgroundTask, type BackgroundTaskInfoBase, type BackgroundTaskSink } from './task';
import type { SessionSubagentHost, SubagentHandle } from '../../session/subagent-host';
export interface AgentBackgroundTaskInfo extends BackgroundTaskInfoBase {
    readonly kind: 'agent';
    /** Subagent identifier accepted by Agent(resume=...). */
    readonly agentId?: string;
    /** Subagent profile name. */
    readonly subagentType?: string;
    /** Display-normalized bound model alias (populated by the v2 engine). */
    readonly model?: string;
    /** The subagent's effective thinking effort at spawn (v2 engine). */
    readonly thinkingEffort?: string;
}
export declare class AgentBackgroundTask implements BackgroundTask {
    private readonly handle;
    readonly description: string;
    private readonly subagentHost;
    private readonly abortController;
    readonly kind: "agent";
    readonly idPrefix: string;
    readonly agentId: string;
    readonly subagentType: string;
    constructor(handle: SubagentHandle, description: string, subagentHost: Pick<SessionSubagentHost, 'markActiveChildDetached'>, abortController: AbortController);
    start(sink: BackgroundTaskSink): Promise<void>;
    onDetach(): void;
    toInfo(base: BackgroundTaskInfoBase): AgentBackgroundTaskInfo;
}
