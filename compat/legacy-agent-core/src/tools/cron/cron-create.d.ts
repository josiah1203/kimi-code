/**
 * CronCreateTool — schedule a prompt to be re-injected into this session
 * at a future wall-clock time, either once (`recurring: false`) or on a
 * cron cadence (`recurring: true`, the default).
 *
 * Tasks live in `SessionCronStore` and are mirrored to
 * `<sessionDir>/cron/<id>.json` via `CronManager.addTask`, so resuming
 * the same session reloads them and the scheduler
 * picks up where it left off (fires that fell during downtime are
 * collapsed into a single delivery with `coalescedCount`). Tasks do
 * NOT carry over into a brand-new session.
 *
 * The tool itself is pure validation + bookkeeping; the firing /
 * coalesce / jitter logic lives in `CronScheduler` (one layer below)
 * and `CronManager` (one layer up). This file only knows how to:
 *
 *   1. validate the request (killswitch, cron parse, 5-year window,
 *      session cap, byte-length cap);
 *   2. add it to the manager (which writes through to disk on success);
 *   3. report back the post-jitter `nextFireAt` and a human-readable
 *      schedule for the model's benefit;
 *   4. emit `cron_scheduled` telemetry through the manager (the tool
 *      does **not** reach into `manager.agent.telemetry` directly).
 */
import { z } from 'zod';
import type { BuiltinTool } from '../../agent/tool';
import type { CronManager } from '../../agent/cron';
import type { ToolExecution } from '../../loop/types';
/**
 * Session-level cap on the number of live cron tasks. Exported so tests
 * can pre-fill the store without re-deriving the magic number.
 */
export declare const MAX_CRON_JOBS_PER_SESSION = 50;
export declare const CronCreateInputSchema: z.ZodObject<{
    cron: z.ZodString;
    prompt: z.ZodString;
    recurring: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
export type CronCreateInput = z.Infer<typeof CronCreateInputSchema>;
export declare class CronCreateTool implements BuiltinTool<CronCreateInput> {
    private readonly manager;
    readonly name: "CronCreate";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(manager: CronManager);
    resolveExecution(args: CronCreateInput): ToolExecution;
}
