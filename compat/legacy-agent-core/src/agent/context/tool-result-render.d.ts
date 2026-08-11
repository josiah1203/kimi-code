/**
 * The single place where a stored tool result (pure data + structured
 * status/note) is rendered into the content the model actually receives.
 *
 * History and wire records store facts: the tool's own `output`, the
 * structured `isError` flag, and an optional `note` (content routed to the
 * model but never to user-facing UIs — see `ExecutableToolResult.note`).
 * Rendering those facts into model-visible text is a provider-boundary
 * concern and happens exactly once, here:
 *
 * - a failed call gets a `<system>`-wrapped `ERROR:` status line, added
 *   unconditionally so the harness verdict is never confused with tool
 *   output that merely contains error-like text;
 * - an empty output is replaced with a `<system>`-wrapped placeholder so
 *   strict providers do not reject an empty tool message;
 * - the note, when present, is appended verbatim. No wrapping is added: any
 *   formatting is the producing tool's choice. A text-only result keeps a
 *   SINGLE text part (note joined with a newline): providers serialize that
 *   as plain string tool content — some OpenAI-compatible backends reject
 *   content-part arrays on tool messages, and joining providers (Google
 *   GenAI, `extract_text`) concatenate parts without a separator. Media-
 *   bearing results get the note as their own trailing text part.
 *
 * Together with the producers' own `<system>`-wrapped notes, every piece of
 * system-generated text inside a tool result carries the same marker, so
 * the model can always tell harness information from tool data. UIs never
 * see any of it — they render the raw output and style failures via the
 * structured `isError` flag.
 *
 * Callers: the live LLM projection (`agent/context/projector.ts`) and the
 * vis debugger's model view, which must mirror the live projection exactly.
 */
import type { ContentPart } from '@spiderbyte/kosong';
export declare const TOOL_ERROR_STATUS = "<system>ERROR: Tool execution failed.</system>";
export declare const TOOL_EMPTY_STATUS = "<system>Tool output is empty.</system>";
export declare const TOOL_EMPTY_ERROR_STATUS = "<system>ERROR: Tool execution failed. Tool output is empty.</system>";
export interface RenderableToolResult {
    readonly output: string | readonly ContentPart[];
    readonly note?: string | undefined;
    readonly isError?: boolean | undefined;
}
export declare function renderToolResultForModel(result: RenderableToolResult): ContentPart[];
