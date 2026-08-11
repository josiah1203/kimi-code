/**
 * `IMessageService` — daemon-facing message history interface.
 *
 * Wraps `ICoreProcessService.rpc.getContext({sessionId, agentId})` and adapts
 * agent-core's `ContextMessage` history shape (kosong `Message` + origin) to
 * the protocol's SCHEMAS.md §3 `Message` discriminated-by-content union.
 *
 * Endpoint mapping (REST.md §3.4):
 *   GET  /v1/sessions/{sid}/messages         → list(sid, ListMessagesQuery)
 *   GET  /v1/sessions/{sid}/messages/{mid}   → get(sid, mid)
 *
 * Sentinel errors:
 *   - `SessionNotFoundError`   → 40401 at the route layer
 *   - `MessageNotFoundError`   → 40403 at the route layer
 *
 * The adapter is documented in the implementation below.
 *
 * **Field mapping** (kosong/agent-core → protocol):
 *
 *   ContextMessage.role               →  Message.role            (1:1)
 *   ContextMessage.content[]          →  Message.content[]       (per-part adapter; see below)
 *   ContextMessage.toolCalls[]        →  Message.content[]       (appended as `tool_use` content parts)
 *   ContextMessage.toolCallId         →  Message.content[].tool_call_id  (when role==='tool', body becomes a tool_result)
 *   ContextMessage.isError            →  Message.content[0].is_error (only on tool_result)
 *
 * Content-part adapter (kosong ContentPart → SCHEMAS MessageContent):
 *
 *   { type:'text',      text }            → { type:'text', text }
 *   { type:'think',     think, encrypted? } → { type:'thinking', thinking:think, signature?:encrypted }
 *   { type:'image_url', imageUrl }        → { type:'image', source:{kind:'url', url:imageUrl.url } }
 *                                            (file/base64 reserved for future kosong shape)
 *   { type:'audio_url', audioUrl }        → { type:'text', text:`[audio:${audioUrl.url}]` }
 *                                            (SCHEMAS §3 has no audio content variant; flatten lossy)
 *   { type:'video_url', videoUrl }        → { type:'text', text:`[video:${videoUrl.url}]` }
 *                                            (same as audio — no video variant in §3)
 *
 * **ID synthesis**: kosong's `Message` has no `id`. We derive a deterministic
 * id from `(sessionId, history_index)`:
 *
 *     id = `msg_<sessionId>_<6-digit-index>`
 *
 * **Pagination**: SCHEMAS §1.3 / REST §3.4 say default 50, max 100 — applied
 * at the route layer. This impl receives a fully-validated query.
 */
import type { ContextMessage } from '../../agent/context';
import type { CursorQuery, Message, MessageRole, PageResponse } from '@spiderbyte/protocol';
/**
 * Listing query — `before_id`/`after_id` + `page_size` mutex is enforced
 * by `cursorQuerySchema`. The service layer adds an optional role filter.
 */
export interface MessageListQuery extends CursorQuery {
    role?: MessageRole;
}
export interface IMessageService {
    readonly _serviceBrand: undefined;
    /**
     * `GET /v1/sessions/{sid}/messages` — paginated message history.
     *
     * Default `page_size = 50`, max 100 (REST.md §3.4 / SCHEMAS §1.3).
     * Defaults are applied at the route layer.
     *
     * `before_id` / `after_id` are cursors keyed on message id (ULID, time
     * sortable). Result order is `created_at desc`; clients displaying in
     * ascending order should `.reverse()`.
     *
     * Throws `SessionNotFoundError` (→ 40401) when `sid` doesn't exist.
     */
    list(sid: string, query: MessageListQuery): Promise<PageResponse<Message>>;
    /**
     * `GET /v1/sessions/{sid}/messages/{mid}` — single message by id.
     *
     * Throws `SessionNotFoundError` (→ 40401) when `sid` doesn't exist.
     * Throws `MessageNotFoundError` (→ 40403) when the session is known but
     * no message with `mid` lives in its history.
     */
    get(sid: string, mid: string): Promise<Message>;
}
export declare const IMessageService: import("../..").ServiceIdentifier<IMessageService>;
/**
 * Sentinel error — daemon's route layer catches and maps to
 * `code: 40403` (message.not_found).
 */
export declare class MessageNotFoundError extends Error {
    readonly sessionId: string;
    readonly messageId: string;
    constructor(sessionId: string, messageId: string);
}
/**
 * Derive a stable opaque message id from (sessionId, index). Format is
 * documented in the module header.
 */
export declare function deriveMessageId(sessionId: string, index: number): string;
/**
 * Inverse of `deriveMessageId`: parse `msg_<sessionId>_<index>` back into
 * `{sessionId, index}`. Returns `undefined` if the id doesn't match the
 * `MessageService` ULID-shape contract.
 */
export declare function parseMessageId(messageId: string): {
    sessionId: string;
    index: number;
} | undefined;
/**
 * Convert one history-array entry into the protocol's `Message` shape.
 *
 * `sessionCreatedAtMs` is the session's `createdAt` (ms). We add the index
 * so per-message `created_at` increases monotonically across the array.
 * Callers that know the real record time can pass `createdAtMs` to override
 * the synthesized value (MessageService does this for wire-derived entries).
 */
export declare function toProtocolMessage(sessionId: string, index: number, msg: ContextMessage, sessionCreatedAtMs: number, createdAtMsOverride?: number): Message;
