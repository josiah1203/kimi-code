import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
export declare class SwarmModeAgentSwarmApprovePermissionPolicy implements PermissionPolicy {
    private readonly agent;
    readonly name = "swarm-mode-agent-swarm-approve";
    constructor(agent: Agent);
    evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined;
}
