/**
 * Shared predicates and shaping helpers for select_tools progressive
 * disclosure protocol context.
 *
 * Two kinds of messages carry that protocol state in the history:
 *   - dynamic tool schema messages: `role: 'system'` messages whose `tools`
 *     field holds full tool definitions (origin
 *     `{kind: 'injection', variant: 'dynamic_tool_schema'}` so undo keeps
 *     them — tool loading is protocol context, not conversation);
 *   - loadable-tools announcements: `<tools_added>/<tools_removed>` system
 *     reminders (origin `{kind: 'system_trigger', name: 'loadable-tools'}` so
 *     undo removes them and the next turn-boundary diff self-heals).
 *
 * Everything here anchors on `origin` or the `tools` field, so callers that
 * need to filter MUST run before `project()` — projection strips `origin`.
 */
import type { ContextMessage } from './types';
/** Origin variant of an injected dynamic tool schema message (undo keeps it). */
export declare const DYNAMIC_TOOL_SCHEMA_VARIANT = "dynamic_tool_schema";
/** Origin name of the loadable-tools diff announcements (undo removes them). */
export declare const LOADABLE_TOOLS_TRIGGER = "loadable-tools";
/** True for a message that loads tool definitions (`message.tools` present). */
export declare function isDynamicToolSchemaMessage(message: ContextMessage): boolean;
/** True for a `<tools_added>/<tools_removed>` announcement reminder. */
export declare function isLoadableToolsAnnouncement(message: ContextMessage): boolean;
/**
 * Shape a history for a consumer that must not see dynamic-tool protocol
 * context: drop the loadable-tools announcements and strip `message.tools`
 * (dropping the message entirely when nothing else remains). Two callers:
 *   - projection for a model without the dynamically-loaded-tools capability
 *     (mid-session model switch — the canonical history keeps its shape, only
 *     the outgoing view changes; announcements would be noise and even
 *     reference a select_tools tool the model does not have);
 *   - the compaction summarizer input (schemas and announcements are protocol
 *     context, not conversation — summarizing them wastes tokens and risks
 *     leaking schema text into the summary).
 * Returns the input array unchanged when there is nothing to strip, so the
 * common no-dynamic-tools path costs one scan and no allocation.
 */
export declare function stripDynamicToolContext(history: readonly ContextMessage[]): readonly ContextMessage[];
/** Union of tool names loaded by dynamic tool schema messages in `history`. */
export declare function collectLoadedDynamicToolNames(history: readonly ContextMessage[]): Set<string>;
/**
 * Fold every loadable-tools announcement in `history`, in order, into the
 * currently-announced name set (`tools_removed` deletes, then `tools_added`
 * adds — last wins). The announcements are the context's own record of what
 * the model has been told is loadable; there is deliberately no separate
 * persisted ledger, so undo/compaction/resume all self-heal by re-folding.
 */
export declare function foldAnnouncedToolNames(history: readonly ContextMessage[]): Set<string>;
/**
 * Render one diff announcement. Only the blocks with content are emitted; the
 * guidance sentence never contains a literal block tag, so `foldAnnouncedToolNames`
 * can anchor on the tags without tripping over prose.
 */
export declare function renderLoadableToolsAnnouncement(added: readonly string[], removed: readonly string[]): string;
