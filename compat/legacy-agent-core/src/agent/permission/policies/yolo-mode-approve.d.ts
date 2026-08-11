import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyResult } from '../types';
export declare class YoloModeApprovePermissionPolicy implements PermissionPolicy {
    private readonly agent;
    readonly name = "yolo-mode-approve";
    constructor(agent: Agent);
    evaluate(): PermissionPolicyResult | undefined;
}
