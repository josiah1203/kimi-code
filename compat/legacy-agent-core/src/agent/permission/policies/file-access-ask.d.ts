import type { Agent } from '../..';
import type { ToolFileAccess } from '../../../loop/tool-access';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
export declare class SensitiveFileAccessAskPermissionPolicy implements PermissionPolicy {
    readonly name = "sensitive-file-access-ask";
    evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined;
}
export declare class GitControlPathAccessAskPermissionPolicy implements PermissionPolicy {
    private readonly agent;
    readonly name = "git-control-path-access-ask";
    constructor(agent: Agent);
    evaluate(context: PermissionPolicyContext): Promise<PermissionPolicyResult | undefined>;
}
export declare function writeFileAccesses(context: PermissionPolicyContext): ToolFileAccess[];
