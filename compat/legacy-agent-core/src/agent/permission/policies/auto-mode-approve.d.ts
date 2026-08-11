import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyResult } from '../types';
export declare class AutoModeApprovePermissionPolicy implements PermissionPolicy {
    private readonly agent;
    readonly name = "auto-mode-approve";
    constructor(agent: Agent);
    evaluate(): PermissionPolicyResult | undefined;
}
