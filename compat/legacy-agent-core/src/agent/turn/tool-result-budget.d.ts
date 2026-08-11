import type { ExecutableToolResult } from '../../loop';
interface BudgetToolResultOptions {
    readonly homedir?: string;
    readonly toolName: string;
    readonly toolCallId: string;
    readonly result: ExecutableToolResult;
}
export declare function budgetToolResultForModel(options: BudgetToolResultOptions): Promise<ExecutableToolResult>;
export {};
