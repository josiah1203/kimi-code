import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
export declare class PreToolCallHookPermissionPolicy implements PermissionPolicy {
    private readonly agent;
    readonly name = "pre-tool-call-hook";
    constructor(agent: Agent);
    evaluate(context: PermissionPolicyContext): Promise<PermissionPolicyResult | undefined>;
}
