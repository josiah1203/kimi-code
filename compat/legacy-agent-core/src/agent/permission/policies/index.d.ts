import type { Agent } from '../..';
import type { PermissionPolicy } from '../types';
/** Permission policies run in order; the first non-undefined result wins. */
export declare function createPermissionDecisionPolicies(agent: Agent): PermissionPolicy[];
