import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
export declare class ExitPlanModeReviewAskPermissionPolicy implements PermissionPolicy {
    private readonly agent;
    readonly name = "exit-plan-mode-review-ask";
    constructor(agent: Agent);
    evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined;
    private exitPlanModeApprovalResult;
    private rejectedExitPlanModeApprovalResult;
    private exitPlanMode;
    private trackRejectedPlanResolution;
}
