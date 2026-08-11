import type { KaosProcess } from '@spiderbyte/kaos';
import type { BackgroundTask, BackgroundTaskInfoBase, BackgroundTaskSink } from './task';
export interface ProcessBackgroundTaskInfo extends BackgroundTaskInfoBase {
    readonly kind: 'process';
    readonly command: string;
    readonly pid: number;
    readonly exitCode: number | null;
}
export type ProcessBackgroundTaskOutputKind = 'stdout' | 'stderr';
export type ProcessBackgroundTaskOutputCallback = (kind: ProcessBackgroundTaskOutputKind, text: string) => void;
export declare class ProcessBackgroundTask implements BackgroundTask {
    readonly proc: KaosProcess;
    readonly command: string;
    readonly description: string;
    private readonly onOutput?;
    readonly kind: "process";
    readonly idPrefix = "bash";
    private exitCode;
    constructor(proc: KaosProcess, command: string, description: string, onOutput?: ProcessBackgroundTaskOutputCallback | undefined);
    start(sink: BackgroundTaskSink): Promise<void>;
    forceStop(): Promise<void>;
    toInfo(base: BackgroundTaskInfoBase): ProcessBackgroundTaskInfo;
    private disposeProcess;
}
