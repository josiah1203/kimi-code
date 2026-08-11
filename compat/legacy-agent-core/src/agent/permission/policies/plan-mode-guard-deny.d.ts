import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
export declare class PlanModeGuardDenyPermissionPolicy implements PermissionPolicy {
    private readonly agent;
    readonly name = "plan-mode-guard-deny";
    constructor(agent: Agent);
    evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined;
}
