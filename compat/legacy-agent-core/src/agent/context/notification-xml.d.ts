/**
 * Notification XML rendering — produces the chat-history injection text
 * shared between the live ContextMemory and the projector.
 *
 * Output shape:
 *   <notification id="..." category="..." type="..." source_kind="..." source_id="..." [agent_id="..."]>
 *   Title: ...
 *   Severity: ...
 *   <body>
 *   <children...>
 *   </notification>
 *
 * The opening tag name (`<notification `) is load-bearing for notification
 * consumers that detect chat-history injections.
 *
 * `agent_id` is emitted only for background_task notifications whose
 * source task is an agent subagent — surfacing it structurally lets the
 * LLM identify the correct id to pass to `Agent(resume=...)` without
 * having to grep the body or the original spawn-success ToolResult.
 * It is intentionally a separate attribute from `source_id`: the two
 * look alike (`agent-...`) but live in different namespaces.
 */
export declare function renderNotificationXml(data: Record<string, unknown>): string;
