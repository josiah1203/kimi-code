/**
 * MCP tool-call result → ExecutableTool output pipeline.
 *
 * Owns the full path from "MCP protocol content blocks" to "what the agent
 * loop feeds back to the model":
 *  1. Convert each {@link MCPContentBlock} to a kosong `ContentPart`
 *     (dropping unsupported shapes).
 *  2. Wrap media-only outputs in `<mcp_tool_result name="…">` tags so the
 *     model can attribute binary output when several tools return media.
 *     Mirrors the in-tree `ReadMediaFile` convention.
 *  3. Apply the 100K text/think character budget to the tool's own text.
 *     This runs BEFORE captions exist, so a chatty tool (page text + a
 *     screenshot) can never evict or slice the compression caption — that
 *     would silently reintroduce the very degradation the caption reports.
 *  4. Compress oversized inline images, announcing each compression with a
 *     caption (original vs. sent size, readback path to the persisted
 *     original) so downsampling is never silent. The captions come back
 *     from the compressor as data and ride the result's `note` side
 *     channel — rendered to the model at projection time, never to UIs.
 *  5. Apply the per-part 10 MB binary cap: oversized binary parts
 *     (image/audio/video URLs) collapse to a notice, so a single
 *     screenshot cannot evict every text part.
 *  6. Collapse a single-text-part result to a plain string output; otherwise
 *     emit the `ContentPart[]` as-is.
 *
 * `mcpResultToExecutableOutput` is the single entry point; the per-step
 * helpers stay private so callers cannot bypass the limits.
 */
import type { ContentPart } from '@spiderbyte/kosong';
import type { TelemetryClient } from '#/telemetry';
import type { MCPContentBlock, MCPToolResult } from './types';
export interface McpOutputOptions {
    /**
     * Session-owned directory for pre-compression originals (typically
     * `sessionMediaOriginalsDir(sessionDir)` threaded down from the agent).
     * Falls back to the shared temp-dir cache when absent.
     */
    readonly originalsDir?: string | undefined;
    /** Report an `image_compress` event per compressed tool-result image. */
    readonly telemetry?: TelemetryClient | undefined;
    /** Owner-resolved longest-edge ceiling (px) for tool-result images. */
    readonly maxImageEdgePx?: number | undefined;
}
export declare const MCP_MAX_OUTPUT_CHARS = 100000;
export declare const MCP_MAX_BINARY_PART_BYTES: number;
/**
 * Convert a single MCP content block into a kosong {@link ContentPart}.
 *
 * Returns `null` for block types that cannot be represented (e.g. unknown
 * resource shapes) so the caller can drop them.
 */
export declare function convertMCPContentBlock(block: MCPContentBlock): ContentPart | null;
/**
 * Convert an `MCPToolResult` into the success-shape `ExecutableToolResult`
 * output the agent loop expects.
 *
 * `qualifiedToolName` is the agent-side qualified name (e.g.
 * `mcp__github__create_pr`) — embedded into the `<mcp_tool_result name="…">`
 * wrap when the result is media-only, so the model can attribute binary parts.
 */
export declare function mcpResultToExecutableOutput(result: MCPToolResult, qualifiedToolName: string, options?: McpOutputOptions): Promise<{
    output: string | ContentPart[];
    isError: boolean;
    note?: string;
    truncated?: true;
}>;
