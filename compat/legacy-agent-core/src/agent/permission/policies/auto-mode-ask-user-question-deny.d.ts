import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
export declare class AutoModeAskUserQuestionDenyPermissionPolicy implements PermissionPolicy {
    private readonly agent;
    readonly name = "auto-mode-ask-user-question-deny";
    constructor(agent: Agent);
    evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined;
}
