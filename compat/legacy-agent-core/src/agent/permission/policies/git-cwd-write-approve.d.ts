import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
export declare class GitCwdWriteApprovePermissionPolicy implements PermissionPolicy {
    private readonly agent;
    readonly name = "git-cwd-write-approve";
    constructor(agent: Agent);
    evaluate(context: PermissionPolicyContext): Promise<PermissionPolicyResult | undefined>;
}
