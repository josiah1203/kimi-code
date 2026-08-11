import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
/**
 * Starting a goal turns the agent loose on autonomous, multi-turn work, so a
 * model-issued `CreateGoal` is confirmed with the same menu the `/goal` command
 * shows: choose the permission mode to run the goal under, or decline. The
 * chosen mode is applied before the goal is created so the run proceeds under
 * it. `auto` mode auto-approves the goal upstream and never reaches here.
 */
export declare class GoalStartReviewAskPermissionPolicy implements PermissionPolicy {
    private readonly agent;
    readonly name = "goal-start-review-ask";
    constructor(agent: Agent);
    evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined;
    private resolveGoalStart;
}
