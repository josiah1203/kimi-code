import type { Agent } from '..';
export type PlanData = null | {
    id: string;
    content: string;
    path: string;
};
export type PlanFilePath = string | null;
export declare class PlanMode {
    protected readonly agent: Agent;
    protected _isActive: boolean;
    protected _planId: null | string;
    protected _planFilePath: PlanFilePath;
    constructor(agent: Agent);
    createPlanId(): string;
    enter(id?: string, createFile?: boolean, emitStatus?: boolean): Promise<void>;
    restoreEnter({ id }: {
        readonly id: string;
    }): void;
    cancel(id?: string): void;
    clear(): Promise<void>;
    exit(id?: string): void;
    get isActive(): boolean;
    get planFilePath(): PlanFilePath;
    data(): Promise<PlanData>;
    private writeEmptyPlanFile;
    private ensurePlanDirectory;
    private planFilePathFor;
}
