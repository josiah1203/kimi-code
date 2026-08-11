import type { Agent } from '..';
import type { PrepareToolExecutionResult } from '../../loop';
import type { PermissionApprovalResultRecord, PermissionData, PermissionMode, PermissionPolicy, PermissionPolicyContext, PermissionRule } from './types';
export * from './types';
export interface PermissionManagerOptions {
    readonly initialRules?: readonly PermissionRule[];
    readonly parent?: PermissionManager;
}
export declare class PermissionManager {
    protected readonly agent: Agent;
    readonly policies: PermissionPolicy[];
    readonly rules: PermissionRule[];
    private modeOverride;
    private readonly parent;
    private readonly localSessionApprovalRulePatterns;
    constructor(agent: Agent, options?: PermissionManagerOptions);
    get mode(): PermissionMode;
    set mode(mode: PermissionMode);
    data(): PermissionData;
    setMode(mode: PermissionMode): void;
    recordApprovalResult(record: PermissionApprovalResultRecord): void;
    get sessionApprovalRulePatterns(): readonly string[];
    beforeToolCall(context: PermissionPolicyContext): Promise<PrepareToolExecutionResult | undefined>;
    private requestToolApproval;
    private evaluatePolicies;
    private get effectiveRules();
    private permissionPolicyResolutionToPrepare;
    protected formatApprovalRejectionMessage(toolName: string, result: {
        decision: 'approved' | 'rejected' | 'cancelled';
        feedback?: string;
    }): string;
    private formatPolicyDenyMessage;
}
