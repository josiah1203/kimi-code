/**
 * Process-local scheduler for workspace automations.
 *
 * Definitions and fire cursors remain owned by the workspace automation
 * service. This timer is only a wake-up loop; it never creates a second run
 * engine and delegates due work back to the canonical session prompt path.
 */

import {
  IFlagService,
  IWorkspaceAutomationService,
  IWorkspaceLifecycleService,
  IWorkspaceService,
  type Scope,
} from '@spiderbyte/agent-core';

const DEFAULT_INTERVAL_MS = 60_000;

export class PlatformAutomationScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly core: Scope,
    private readonly onError: (error: unknown, workspaceId: string) => void = () => {},
    private readonly intervalMs = DEFAULT_INTERVAL_MS,
  ) {}

  start(): void {
    if (this.timer !== undefined) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(now = new Date()): Promise<void> {
    if (!this.core.accessor.get(IFlagService).enabled('platform_services')) return;
    const workspaces = await this.core.accessor.get(IWorkspaceService).list();
    await Promise.all(
      workspaces.map(async (workspace) => {
        try {
          const handle = await this.core.accessor.get(IWorkspaceLifecycleService).handlerFor({
            workspaceId: workspace.id,
            root: workspace.root,
          });
          await handle.accessor.get(IWorkspaceAutomationService).fireDue(now);
        } catch (error) {
          this.onError(error, workspace.id);
        }
      }),
    );
  }
}
