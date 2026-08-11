import type { Agent } from '../..';
import { type PermissionRuleMatch } from '../matches-rule';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult, PermissionRuleDecision } from '../types';
declare abstract class UserConfiguredPermissionPolicy {
    protected readonly agent: Agent;
    constructor(agent: Agent);
    protected firstMatchingRule(context: PermissionPolicyContext, decision: PermissionRuleDecision): PermissionRuleMatch | undefined;
}
export declare class UserConfiguredDenyPermissionPolicy extends UserConfiguredPermissionPolicy implements PermissionPolicy {
    readonly name = "user-configured-deny";
    evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined;
}
export declare class UserConfiguredAllowPermissionPolicy extends UserConfiguredPermissionPolicy implements PermissionPolicy {
    readonly name = "user-configured-allow";
    evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined;
}
export declare class UserConfiguredAskPermissionPolicy extends UserConfiguredPermissionPolicy implements PermissionPolicy {
    readonly name = "user-configured-ask";
    evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined;
}
export {};
