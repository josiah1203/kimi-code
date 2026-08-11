import { DynamicInjector } from './injector';
/**
 * Plan-mode reminder variants.
 *
 * `reentry` is used once when a restored planning session already has plan
 * content. `full` is used for the first reminder and periodic refreshes.
 * `sparse` keeps the read-only invariant visible between full reminders.
 */
export type PlanModeVariant = 'full' | 'sparse' | 'reentry';
export declare class PlanModeInjector extends DynamicInjector {
    protected readonly injectionVariant = "plan_mode";
    private wasActive;
    onContextClear(): void;
    getInjection(): Promise<string | undefined>;
    protected getVariant(): PlanModeVariant | null;
    private hasCurrentPlanContent;
}
