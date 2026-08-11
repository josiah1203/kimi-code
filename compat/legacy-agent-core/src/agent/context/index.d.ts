import { type ContentPart, type Message } from '@spiderbyte/kosong';
import type { Agent } from '..';
import type { LoopRecordedEvent } from '../../loop';
import { type CompactionInput, type CompactionResult } from '../compaction';
import { type ProjectOptions } from './projector';
import { type AgentContextData, type ContextMessage, type PromptOrigin } from './types';
export * from './types';
export * from './dynamic-tools';
export declare class ContextMemory {
    protected readonly agent: Agent;
    private _history;
    private _tokenCount;
    private tokenCountCoveredMessageCount;
    private openSteps;
    private pendingToolResultIds;
    private deferredMessages;
    private _lastAssistantAt;
    private lastProjectionRepairSignature;
    constructor(agent: Agent);
    get lastAssistantAt(): number | null;
    appendUserMessage(content: readonly ContentPart[], origin?: PromptOrigin): void;
    appendSystemReminder(content: string, origin: PromptOrigin): void;
    /**
     * Inject a user-invisible message and immediately send it to the model by
     * launching/steering a turn. The content is used as-is (no wrapper tag), so
     * callers can pass raw tool-result-style text or wrap it themselves. The
     * message is skipped on replay / transcript (so the user never sees it) but
     * is included in the context sent to the model. Use this for events the
     * model must react to right away without surfacing a user-visible message.
     */
    injectAndNotify(content: string, origin?: PromptOrigin): void;
    appendLocalCommandStdout(content: string): void;
    appendBashInput(command: string): void;
    appendBashOutput(stdout: string, stderr: string, isError?: boolean): void;
    popMatchedMessage(matcher: (origin: PromptOrigin | undefined) => boolean): boolean;
    clear(): void;
    importContext(content: string, source: string): void;
    updateTokenCount(tokenCount: number): void;
    undo(count: number): void;
    applyCompaction(input: CompactionInput): CompactionResult;
    data(): AgentContextData;
    get tokenCount(): number;
    get tokenCountWithPending(): number;
    get history(): readonly ContextMessage[];
    project(messages: readonly ContextMessage[], options?: ProjectOptions): Message[];
    private reportProjectionRepairs;
    get messages(): Message[];
    get strictMessages(): Message[];
    get mediaDegradedMessages(): Message[];
    /**
     * Compatibility projection that strips every media part visible now. Turn
     * recovery uses its own captured snapshot so newly produced media can pass;
     * direct callers retain the historical all-current-media behavior here.
     */
    get mediaStrippedMessages(): Message[];
    useProjectedHistoryFrom(source: ContextMemory): void;
    finishResume(): void;
    private closePendingToolResults;
    /**
     * Defensive teardown for a live turn that ended — normally, cancelled, or
     * failed — while recorded tool calls were still awaiting results (e.g. the
     * batch's result dispatch died after a `tool.call` was already recorded).
     * Synthesizes an error result for each dangling call so the exchange closes:
     * left open, it would keep `hasOpenToolExchange` true and strand every later
     * message in `deferredMessages`, silently swallowing user input. No-op when
     * the exchange is already closed. Returns the number of calls it closed.
     */
    closeAbandonedToolExchange(output: string): number;
    appendLoopEvent(event: LoopRecordedEvent): void;
    appendMessage(message: ContextMessage): void;
    private flushDeferredMessagesIfToolExchangeClosed;
    private hasOpenToolExchange;
    private pushHistory;
}
