import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
export declare class AgentSwarmExclusiveDenyPermissionPolicy implements PermissionPolicy {
    readonly name = "agent-swarm-exclusive-deny";
    evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined;
}
