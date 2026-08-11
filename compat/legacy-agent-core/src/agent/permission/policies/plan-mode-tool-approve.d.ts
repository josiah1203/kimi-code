import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
export declare class PlanModeToolApprovePermissionPolicy implements PermissionPolicy {
    private readonly agent;
    readonly name = "plan-mode-tool-approve";
    constructor(agent: Agent);
    evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined;
}
