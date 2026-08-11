import type { ActivateSkillPayload } from '#/rpc';
import type { ContentPart } from '@spiderbyte/kosong';
import type { Agent } from '..';
import type { SkillActivationOrigin } from '../context';
import type { SkillRegistry } from './types';
export type { SkillRegistry } from './types';
export declare class SkillManager {
    protected readonly agent: Agent;
    readonly registry: SkillRegistry;
    constructor(agent: Agent, registry: SkillRegistry);
    activate(input: ActivateSkillPayload): void;
    recordActivation(origin: SkillActivationOrigin, input?: readonly ContentPart[] | undefined): void;
}
