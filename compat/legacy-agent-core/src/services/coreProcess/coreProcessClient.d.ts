/**
 * `BridgeClientAPI` — the SDK side of the in-process RPC pair owned by
 * `CoreProcessService`. Satisfies `SDKAPI` (`@spiderbyte/legacy-agent-core`
 * rpc/sdk-api.ts:78, via `SDKAgentAPI` at :67-72) so `KimiCore` can call
 * into it through `createRPC<CoreAPI, SDKAPI>()`. Methods route to
 * DI-resolved peer services:
 *
 *   emitEvent(event)        → IEventService.publish(event)
 *   requestApproval(req)    → IApprovalService.request(req)
 *   requestQuestion(req)    → IQuestionService.request(req)
 *   toolCall(req)           → unsupported (SDK custom tool calls not used here)
 *
 * The protocol↔in-process adapters (SCHEMAS.md §6.4 snake_case shapes, REST
 * request/response Zod validation) live at the daemon REST boundary —
 * NOT here. The peer-service interfaces stay SDK-shaped.
 */
import type { ApprovalRequest, ApprovalResponse, Event, QuestionRequest, QuestionResult, SDKAPI, ToolCallRequest, ToolCallResponse } from '../../rpc';
import type { IApprovalService } from '../approval/approval';
import type { IEventService } from '../event/event';
import type { ILogService } from '../logger/logger';
import type { IQuestionService } from '../question/question';
export interface CoreProcessClientDeps {
    readonly eventService: IEventService;
    readonly approvalService: IApprovalService;
    readonly questionService: IQuestionService;
    readonly logService: ILogService;
}
export declare class BridgeClientAPI implements SDKAPI {
    private readonly deps;
    constructor(deps: CoreProcessClientDeps);
    emitEvent(event: Event): void;
    requestApproval(request: ApprovalRequest & {
        sessionId: string;
        agentId: string;
    }): Promise<ApprovalResponse>;
    requestQuestion(request: QuestionRequest & {
        sessionId: string;
        agentId: string;
    }, options?: {
        signal?: AbortSignal;
    }): Promise<QuestionResult>;
    toolCall(request: ToolCallRequest & {
        sessionId: string;
        agentId: string;
    }): Promise<ToolCallResponse>;
}
