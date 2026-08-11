import { DynamicInjector } from './injector';
/**
 * Injects the current goal into the main agent's context once per turn, at the
 * continuation boundary (see `InjectionManager.injectGoal`), not per model step.
 * The objective is treated as user-provided task data wrapped in
 * `<untrusted_objective>` — it describes the work but does not override
 * higher-priority instructions (system/developer messages, tool schemas,
 * permission rules, host controls).
 *
 * This injector never enforces budgets; the goal driver (`TurnFlow.driveGoal`)
 * owns hard continuation stops.
 */
export declare class GoalInjector extends DynamicInjector {
    protected readonly injectionVariant = "goal";
    protected getInjection(): string | undefined;
}
