import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
export declare class SessionApprovalHistoryPermissionPolicy implements PermissionPolicy {
    private readonly agent;
    readonly name = "session-approval-history";
    constructor(agent: Agent);
    evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined;
    private matchSessionApprovalRule;
}
