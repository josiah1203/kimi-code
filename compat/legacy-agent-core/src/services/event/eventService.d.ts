/**
 * `EventService` — implementation of `IEventService`.
 *
 * Pure in-process pub-sub: a thin wrapper over `Emitter<Event>`. No
 * sessionId extraction, no per-session sequence numbers, no ring buffer, no
 * WS fan-out — those daemon transport concerns live in kap-server's
 * `transport/ws/v1/sessionEventBroadcaster.ts`, which subscribes to this
 * bus via `onDidPublish` and handles the broadcast/replay machinery.
 *
 * Listener exceptions route to `onUnexpectedError` inside `Emitter.fire()`
 * (per agent-core's `Emitter` contract). We do NOT wrap individual handlers.
 *
 * Publishing after `dispose()` is a no-op.
 */
import { Disposable } from '../../di';
import type { Event as ProtocolEvent } from '@spiderbyte/protocol';
import { IEventService } from './event';
export declare class EventService extends Disposable implements IEventService {
    readonly _serviceBrand: undefined;
    /**
     * VSCode-style Emitter. Owned via `_register` so it disposes when the
     * service is torn down. Listener exceptions route to `onUnexpectedError`
     * inside `Emitter.fire()`.
     */
    private readonly _onDidPublish;
    readonly onDidPublish: import("../../base/common/event").Event<ProtocolEvent>;
    publish(event: ProtocolEvent): void;
}
