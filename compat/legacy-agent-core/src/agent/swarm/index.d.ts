import type { Agent } from '..';
/**
 * manual = persistent toggle (/swarm on);
 * task = one-shot /swarm prompt;
 * tool = AgentSwarm entry.
 */
export type SwarmModeTrigger = 'manual' | 'task' | 'tool';
export declare class SwarmMode {
    protected readonly agent: Agent;
    protected active: SwarmModeTrigger | null;
    constructor(agent: Agent);
    enter(trigger: SwarmModeTrigger): void;
    restoreEnter(trigger: SwarmModeTrigger): void;
    exit(): void;
    get isActive(): boolean;
    get shouldAutoExit(): boolean;
}
