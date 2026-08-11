/**
 * CronDeleteTool — cancel a scheduled cron job by id.
 *
 * The tool's job is intentionally narrow: validate the id shape, ask the
 * session store to drop the entry, and report whether anything was
 * actually removed. The scheduler picks up the deletion on its next
 * `tick()` automatically because `source: () => store.list()` is
 * re-read every pass — there is no separate "unsubscribe" handshake to
 * keep in sync.
 *
 * Why "not found" is reported as an error:
 *
 *   - The model uses the result string to decide whether to follow up
 *     (e.g. confirm to the user, retry, or move on). Returning a
 *     success-shaped message for a no-op would silently teach the model
 *     that CronDelete is idempotent against missing ids, which it is
 *     not — the next `CronList` would still show whatever id the model
 *     thought it deleted. Surfacing `isError: true` lets the model
 *     correct itself (typically by calling `CronList` again).
 *
 * Why the manager is not consulted for telemetry on the not-found
 * branch:
 *
 *   - `cron_deleted` records an actual state change. Emitting it on a
 *     miss would inflate the metric and break parity with `cron_create`
 *     (which never fires on a rejected schedule). The branch is fully
 *     observable through tool-call telemetry already.
 *
 * Refresh-cron pattern this tool participates in:
 *
 *   When `CronList` (or a fired job's origin) reports `stale: true`, the
 *   documented "refresh" flow is `CronDelete(id)` followed by a fresh
 *   `CronCreate` with the same cron + prompt. That resets `createdAt`,
 *   clears the stale flag, and rejoins the herd-avoidance jitter draw
 *   with a new task id. The doc string spells this out so the model can
 *   reach for it without prompting from a system message.
 */
import { z } from 'zod';
import type { BuiltinTool } from '../../agent/tool';
import type { CronManager } from '../../agent/cron';
import type { ToolExecution } from '../../loop/types';
export declare const CronDeleteInputSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export type CronDeleteInput = z.infer<typeof CronDeleteInputSchema>;
export declare class CronDeleteTool implements BuiltinTool<CronDeleteInput> {
    private readonly manager;
    readonly name: "CronDelete";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(manager: CronManager);
    resolveExecution(args: CronDeleteInput): ToolExecution;
}
