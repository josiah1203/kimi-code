import type { PermissionPolicy, PermissionPolicyResult } from '../types';
export declare class DenyAllPermissionPolicy implements PermissionPolicy {
    private readonly message;
    readonly name = "deny-all";
    constructor(message: string);
    evaluate(): PermissionPolicyResult;
}
