/**
 * `TaskService` — implementation of `ITaskService`.
 */
import { Disposable } from '../../di';
import type { BackgroundTask } from '@spiderbyte/protocol';
import { ICoreProcessService } from '../coreProcess/coreProcess';
import { ITaskService, type GetTaskOptions, type TaskListQuery } from './task';
export declare class TaskService extends Disposable implements ITaskService {
    private readonly core;
    readonly _serviceBrand: undefined;
    constructor(core: ICoreProcessService);
    list(sessionId: string, query: TaskListQuery): Promise<readonly BackgroundTask[]>;
    get(sessionId: string, taskId: string, options?: GetTaskOptions): Promise<BackgroundTask>;
    cancel(sessionId: string, taskId: string): Promise<{
        cancelled: true;
    }>;
    private _requireSession;
    private _getAllRaw;
}
