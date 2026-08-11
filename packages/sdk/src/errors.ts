import {
  ErrorCodes as AgentErrorCodes,
  errorInfo,
  isError2,
  toErrorPayload,
  type ErrorCode,
  type ErrorPayload,
} from '@spiderbyte/agent-core';

/**
 * Stable SDK error facade.
 *
 * The engine owns the coded-error registry. The SDK adds only the small set
 * of historical request codes that are still part of its local contract; it
 * does not depend on the retired v1 engine to construct or serialize errors.
 */
const SDKRequestErrorCodes = {
  SESSION_ID_EMPTY: 'session.id_empty',
  SESSION_ID_REQUIRED: 'session.id_required',
  SESSION_STATE_INVALID: 'session.state_invalid',
  SESSION_APPROVAL_HANDLER_ERROR: 'session.approval_handler_error',
  SESSION_QUESTION_HANDLER_ERROR: 'session.question_handler_error',
  SESSION_MODEL_EMPTY: 'session.model_empty',
  SESSION_THINKING_EMPTY: 'session.thinking_empty',
  SESSION_PERMISSION_MODE_INVALID: 'session.permission_mode_invalid',
  SESSION_TITLE_EMPTY: 'session.title_empty',
  BACKGROUND_TASK_ID_EMPTY: 'task.task_id_empty',
} as const;

export const ErrorCodes = {
  ...AgentErrorCodes,
  ...SDKRequestErrorCodes,
  // These aliases are intentionally local to the SDK contract. The v2
  // engine's domain registry uses the same wire strings but not every v1
  // symbolic key.
  AUTH_LOGIN_REQUIRED: 'auth.login_required',
  PROVIDER_CONNECTION_ERROR: 'provider.connection_error',
  REQUEST_WORK_DIR_REQUIRED: 'request.work_dir_required',
  REQUEST_PROMPT_INPUT_EMPTY: 'request.prompt_input_empty',
  TURN_AGENT_BUSY: 'turn.agent_busy',
  GOAL_OBJECTIVE_EMPTY: 'goal.objective_empty',
  GOAL_OBJECTIVE_TOO_LONG: 'goal.objective_too_long',
  GOAL_NOT_FOUND: 'goal.not_found',
  GOAL_ALREADY_EXISTS: 'goal.already_exists',
  GOAL_METADATA_RESERVED: 'goal.metadata_reserved',
  MCP_SERVER_NOT_FOUND: 'mcp.server_not_found',
  MCP_SERVER_DISABLED: 'mcp.server_disabled',
  AGENT_NOT_FOUND: 'agent.not_found',
  SKILL_NAME_EMPTY: 'skill.name_empty',
  SESSION_NOT_FOUND: 'session.not_found',
  SESSION_ALREADY_EXISTS: 'session.already_exists',
  SESSION_CLOSED: 'session.closed',
  SESSION_PLAN_MODE_INVALID: 'session.plan_mode_invalid',
  CONFIG_INVALID: 'config.invalid',
  CONTEXT_OVERFLOW: 'context.overflow',
  NOT_IMPLEMENTED: 'not_implemented',
  REQUEST_INVALID: 'request.invalid',
} as const;

export type SpiderByteErrorCode = ErrorCode | (typeof SDKRequestErrorCodes)[keyof typeof SDKRequestErrorCodes];

export interface SpiderByteErrorOptions {
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;
}

export interface SpiderByteErrorInfo {
  readonly title: string;
  readonly retryable: boolean;
  readonly public: boolean;
  readonly action?: string;
}

export type SpiderByteErrorPayload = Omit<ErrorPayload, 'code'> & {
  readonly code: SpiderByteErrorCode;
};

export class SpiderByteError extends Error {
  readonly code: SpiderByteErrorCode;
  readonly details?: Record<string, unknown>;
  override readonly cause?: unknown;

  constructor(code: SpiderByteErrorCode, message: string, options: SpiderByteErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'SpiderByteError';
    this.code = code;
    this.details = options.details;
    this.cause = options.cause;
  }

  get retryable(): boolean {
    return errorInfo(this.code).retryable;
  }
}

export function isSpiderByteError(error: unknown): error is SpiderByteError {
  return error instanceof SpiderByteError || isError2(error);
}

export function normalizeSpiderByteError(error: unknown): unknown {
  if (error instanceof SpiderByteError || !isError2(error)) return error;
  return new SpiderByteError(error.code, error.message, {
    details: error.details === undefined ? undefined : { ...error.details },
    cause: error,
  });
}

export function makeSpiderByteErrorPayload(
  code: SpiderByteErrorCode,
  message: string,
  options?: { readonly details?: Record<string, unknown>; readonly name?: string },
): SpiderByteErrorPayload {
  return {
    code,
    message,
    name: options?.name,
    details: options?.details,
    retryable: errorInfo(code).retryable,
  };
}

export function toSpiderByteErrorPayload(error: unknown): SpiderByteErrorPayload {
  if (error instanceof SpiderByteError) {
    return makeSpiderByteErrorPayload(error.code, error.message, {
      details: error.details,
      name: error.name,
    });
  }
  return toErrorPayload(error) as SpiderByteErrorPayload;
}

export function fromSpiderByteErrorPayload(payload: SpiderByteErrorPayload): SpiderByteError {
  return new SpiderByteError(payload.code, payload.message, {
    details: payload.details === undefined ? undefined : { ...payload.details },
  });
}

export function spiderByteErrorInfo(code: SpiderByteErrorCode): SpiderByteErrorInfo {
  return errorInfo(code);
}
