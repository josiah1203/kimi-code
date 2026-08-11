/**
 * `IToolService` — daemon-facing read-only tool surface.
 *
 * Wraps `ICoreProcessService.rpc.getTools` and translates agent-core's `ToolInfo`
 * (camelCase, includes `'user'` source literal) into SCHEMAS §8 `ToolDescriptor`
 * (snake_case, `'skill'` literal). Adapter helpers (`toProtocolTool`,
 * `AgentCoreToolInfoLike`) are co-located here.
 *
 * **CoreAPI surface used**:
 *   - `bridge.rpc.getTools({}) => readonly ToolInfo[]` (packages/agent-core/src/rpc/core-api.ts:333).
 *
 * **REST.md §3.8 ?session_id behavior**: when caller passes a session_id the
 * route currently returns the same global list — agent-core's `getTools`
 * doesn't differentiate per-session, and `setActiveTools` is the only
 * per-session knob. Documented gap in `ToolService`.
 *
 * **Anti-corruption**: imports `@spiderbyte/legacy-agent-core` only for the
 * `createDecorator` value.
 */
import type { ToolDescriptor } from '@spiderbyte/protocol';
/**
 * In-process minimal shape we accept for tool conversion. Mirrors
 * `@spiderbyte/legacy-agent-core` `ToolInfo` without taking a runtime dependency on
 * its exact shape (the adapter is the boundary).
 */
export interface AgentCoreToolInfoLike {
    readonly name: string;
    readonly description: string;
    readonly source: 'builtin' | 'user' | 'mcp';
    /** agent-core may add fields like `active`; we ignore them. */
    readonly active?: boolean;
}
export declare function toProtocolTool(info: AgentCoreToolInfoLike): ToolDescriptor;
export interface IToolService {
    readonly _serviceBrand: undefined;
    /**
     * Return the available tool descriptors. When `sessionId` is supplied, the
     * impl may return a session-effective subset; today it returns the global
     * list (CoreAPI gap documented in the impl).
     */
    list(sessionId?: string): Promise<readonly ToolDescriptor[]>;
}
export declare const IToolService: import("../..").ServiceIdentifier<IToolService>;
