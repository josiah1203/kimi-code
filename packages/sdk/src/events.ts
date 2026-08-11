import type {
  ApprovalRequest,
  ApprovalResponse,
} from '@spiderbyte/agent-core/session/approval/approval';
import type {
  QuestionItem,
  QuestionOption,
  QuestionRequest,
  QuestionAnswerMethod,
  QuestionAnswers,
  QuestionResponse,
  QuestionResult,
} from '@spiderbyte/agent-core/session/question/question';
import type { ToolInputDisplay } from '@spiderbyte/agent-core/tool/toolInputDisplay';

// Event union plus shared fields/payloads used across event families.
export type { Event } from '@spiderbyte/protocol';

export { MCP_OAUTH_AUTHORIZATION_URL_TOOL_UPDATE } from '@spiderbyte/protocol';

// Session lifecycle/status events and their status payload.
export type {
  AgentStatusUpdatedEvent,
  SessionMetaUpdatedEvent,
  GoalUpdatedEvent,
  SkillActivatedEvent,
  PluginCommandActivatedEvent,
  ErrorEvent,
  WarningEvent,
  UsageStatus,
} from '@spiderbyte/protocol';

// Turn and step lifecycle events plus the turn-ending reason enum.
export type {
  TurnStartedEvent,
  TurnEndedEvent,
  TurnStepStartedEvent,
  TurnStepCompletedEvent,
  TurnStepRetryingEvent,
  TurnStepInterruptedEvent,
  TurnEndReason,
} from '@spiderbyte/protocol';

// Streaming content and hook-result events.
export type {
  AssistantDeltaEvent,
  HookResultEvent,
  ThinkingDeltaEvent,
} from '@spiderbyte/protocol';

// Tool-call events and incremental progress payloads.
export type {
  ToolCallStartedEvent,
  ToolCallDeltaEvent,
  ToolProgressEvent,
  ToolResultEvent,
  ToolUpdate,
  McpOAuthAuthorizationUrlUpdateData,
} from '@spiderbyte/protocol';

// MCP tool-list and server status events.
export type {
  ToolListUpdatedEvent,
  ToolListUpdatedReason,
  McpServerStatusEvent,
  McpServerStatusPayload,
} from '@spiderbyte/protocol';

// Approval and question reverse-RPC payloads are local engine contracts; the
// protocol package owns only the serialized snake_case transport shapes.

// Subagent lifecycle events.
export type {
  SubagentSpawnedEvent,
  SubagentStartedEvent,
  SubagentSuspendedEvent,
  SubagentCompletedEvent,
  SubagentFailedEvent,
} from '@spiderbyte/protocol';

// Compaction lifecycle events and compaction result payload.
export type {
  CompactionStartedEvent,
  CompactionBlockedEvent,
  CompactionCancelledEvent,
  CompactionCompletedEvent,
  CompactionResult,
} from '@spiderbyte/protocol';

// Background task lifecycle events emitted by the BPM. Covers both
// bash (`bash-*`) and agent (`agent-*`) tasks under one wire format.
export type {
  BackgroundTaskStartedEvent,
  BackgroundTaskTerminatedEvent,
} from '@spiderbyte/protocol';

export type { CronFiredEvent } from '@spiderbyte/protocol';

export type MaybePromise<T> = T | Promise<T>;

export type { ApprovalRequest, ApprovalResponse, QuestionItem, QuestionOption, QuestionRequest, QuestionAnswerMethod, QuestionAnswers, QuestionResponse, QuestionResult, ToolInputDisplay };

export type ApprovalDecision = ApprovalResponse['decision'];
export type ApprovalScope = 'session';

export interface ToolCallRequest {
  readonly turnId?: number;
  readonly toolCallId: string;
  readonly args: unknown;
}

export interface ToolCallResponse {
  readonly output: string | import('@spiderbyte/kosong').ContentPart[];
  readonly isError?: boolean;
}

export type ApprovalHandler = (request: ApprovalRequest) => MaybePromise<ApprovalResponse>;

export type QuestionHandler = (request: QuestionRequest) => MaybePromise<QuestionResult>;
