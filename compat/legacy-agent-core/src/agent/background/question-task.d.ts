import type { ExecutableToolResult } from '../../loop/types';
import type { BackgroundTask, BackgroundTaskInfoBase, BackgroundTaskSink } from './task';
export interface QuestionBackgroundTaskInfo extends BackgroundTaskInfoBase {
    readonly kind: 'question';
    readonly questionCount: number;
    readonly toolCallId?: string;
}
export interface QuestionBackgroundTaskOptions {
    readonly questionCount: number;
    readonly toolCallId?: string;
}
export declare class QuestionBackgroundTask implements BackgroundTask {
    private readonly run;
    readonly description: string;
    readonly kind: "question";
    readonly idPrefix = "question";
    readonly questionCount: number;
    readonly toolCallId?: string;
    constructor(run: (signal: AbortSignal) => Promise<ExecutableToolResult>, description: string, options: QuestionBackgroundTaskOptions);
    start(sink: BackgroundTaskSink): Promise<void>;
    toInfo(base: BackgroundTaskInfoBase): QuestionBackgroundTaskInfo;
}
