import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
export declare class DefaultToolApprovePermissionPolicy implements PermissionPolicy {
    readonly name = "default-tool-approve";
    evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined;
}
