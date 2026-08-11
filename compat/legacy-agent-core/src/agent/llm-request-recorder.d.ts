/**
 * Durable request-trace recorder: writes the observability records
 * (`llm.tools_snapshot`, `llm.request`) that make every outbound model
 * request reconstructable from the wire log. Called from the single
 * `Agent.generate` choke point, so loop steps, retry attempts, strict
 * resends, and compaction rounds all leave a trace.
 *
 * Sibling of `LlmRequestLogger` (diagnostic log lines, hashes only); this
 * class owns the wire-record side. See the observability-records note in
 * `records/types.ts` for the persistence contract.
 */
import { type ChatProvider, type Message, type Tool } from '@spiderbyte/kosong';
import type { Agent } from '.';
import type { LLMRequestLogFields } from '../loop';
export declare class LlmRequestRecorder {
    private readonly agent;
    /** Hashes of tool tables already durable in this wire log. */
    private readonly seenToolsHashes;
    /**
     * Identity cache over the last wire tool table. Tool instances are treated
     * as immutable and are stable across steps (rebuilt only by
     * `initializeBuiltinTools` / MCP re-registration), so element-wise identity
     * implies content equality — the common per-step path costs no hashing.
     */
    private lastWireTools;
    private lastToolsHash;
    private lastSystemPrompt;
    private lastSystemPromptHash;
    constructor(agent: Agent);
    /** Replay: a snapshot with this hash is already durable; never re-log it. */
    restoreToolsSnapshot(hash: string): void;
    record(input: {
        readonly provider: ChatProvider;
        readonly systemPrompt: string;
        readonly tools: readonly Tool[];
        readonly messages: readonly Message[];
        readonly fields: LLMRequestLogFields | undefined;
    }): void;
    private toolsHashFor;
    private systemPromptHashFor;
}
