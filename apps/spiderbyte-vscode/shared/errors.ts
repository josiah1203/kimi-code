import type { ErrorPhase } from "./types";

// Keep the Webview's error contract local. The upper-case values are retained
// for persisted session records; the dotted values are emitted by the local
// SpiderByte Agent Core runtime.
const HOST_ERROR_CODES = {
  CLI_NOT_FOUND: "CLI_NOT_FOUND",
  SPAWN_FAILED: "SPAWN_FAILED",
  ALREADY_STARTED: "ALREADY_STARTED",
  STDIN_NOT_WRITABLE: "STDIN_NOT_WRITABLE",
  HANDSHAKE_TIMEOUT: "HANDSHAKE_TIMEOUT",
  PROCESS_CRASHED: "PROCESS_CRASHED",
  LLM_NOT_SET: "LLM_NOT_SET",
  LLM_NOT_SUPPORTED: "LLM_NOT_SUPPORTED",
  INVALID_STATE: "INVALID_STATE",
  CHAT_PROVIDER_ERROR: "CHAT_PROVIDER_ERROR",
  SESSION_BUSY: "SESSION_BUSY",
  SESSION_CLOSED: "SESSION_CLOSED",
  TURN_INTERRUPTED: "TURN_INTERRUPTED",
  INVALID_JSON: "INVALID_JSON",
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_PARAMS: "INVALID_PARAMS",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

// Pre-flight: task didn't start at all or was blocked by "gatekeeper"
export const PREFLIGHT_CODES = new Set<string>([
  HOST_ERROR_CODES.CLI_NOT_FOUND,
  HOST_ERROR_CODES.SPAWN_FAILED,
  HOST_ERROR_CODES.ALREADY_STARTED,
  HOST_ERROR_CODES.STDIN_NOT_WRITABLE,
  HOST_ERROR_CODES.PROCESS_CRASHED,
  HOST_ERROR_CODES.LLM_NOT_SET,
  HOST_ERROR_CODES.LLM_NOT_SUPPORTED,
  HOST_ERROR_CODES.INVALID_STATE,
  HOST_ERROR_CODES.SESSION_BUSY,
  "config.invalid",
  "model.not_configured",
  "session.not_found",
  "session.state_not_found",
  "session.state_invalid",
  "session.init_failed",
  "shell.git_bash_not_found",
]);

// User-friendly error messages
export const ERROR_MESSAGES: Record<string, string> = {
  // Pre-flight
  [HOST_ERROR_CODES.CLI_NOT_FOUND]: "SpiderByte CLI not found.",
  [HOST_ERROR_CODES.SPAWN_FAILED]: "Failed to start SpiderByte CLI.",
  [HOST_ERROR_CODES.ALREADY_STARTED]: "A session is already running.",
  [HOST_ERROR_CODES.STDIN_NOT_WRITABLE]: "Failed to communicate with SpiderByte CLI.",
  [HOST_ERROR_CODES.HANDSHAKE_TIMEOUT]: "Connection timed out.",
  [HOST_ERROR_CODES.PROCESS_CRASHED]: "Process connection lost.",

  // CLI errors
  [HOST_ERROR_CODES.LLM_NOT_SET]: "No model provider is configured.",
  [HOST_ERROR_CODES.LLM_NOT_SUPPORTED]: "This model is not supported.",
  [HOST_ERROR_CODES.INVALID_STATE]: "Please wait for the current operation.",
  [HOST_ERROR_CODES.CHAT_PROVIDER_ERROR]: "The model provider is unavailable.",

  // Session errors
  [HOST_ERROR_CODES.SESSION_BUSY]: "A message is being sent. Please wait.",
  [HOST_ERROR_CODES.SESSION_CLOSED]: "Session was closed.",
  [HOST_ERROR_CODES.TURN_INTERRUPTED]: "Stopped by user.",

  // Protocol errors
  [HOST_ERROR_CODES.INVALID_JSON]: "Communication format error.",
  [HOST_ERROR_CODES.INVALID_REQUEST]: "Invalid request.",
  [HOST_ERROR_CODES.INVALID_PARAMS]: "Invalid parameters.",
  [HOST_ERROR_CODES.INTERNAL_ERROR]: "Internal error occurred.",

  "config.invalid": "SpiderByte configuration is invalid.",
  "model.not_configured": "No model is configured. Configure a local or BYOK provider.",
  "session.not_found": "Session was not found.",
  "session.state_not_found": "Session data is missing.",
  "session.state_invalid": "Session data is invalid.",
  "session.init_failed": "Failed to initialize the session.",
  "session.closed": "Session was closed.",
  "session.fork_active_turn": "Wait for the current response before forking.",
  "turn.agent_busy": "A message is being sent. Please wait.",
  "provider.api_error": "Service temporarily unavailable.",
  "provider.rate_limit": "Too many requests. Please try again later.",
  "provider.auth_error": "The provider rejected its credentials. Check the configured API key.",
  "provider.connection_error": "Could not connect to the model provider.",
  "request.prompt_input_empty": "Prompt cannot be empty.",
  internal: "Internal error occurred.",
};

export function classifyError(code: string): ErrorPhase {
  return PREFLIGHT_CODES.has(code) ? "preflight" : "runtime";
}

export function getUserMessage(code: string, fallback?: string): string {
  return ERROR_MESSAGES[code] || fallback || "An unknown error occurred.";
}

export function isPreflightError(code: string): boolean {
  return PREFLIGHT_CODES.has(code);
}

export function isUserInterrupt(code: string): boolean {
  return code === HOST_ERROR_CODES.TURN_INTERRUPTED || code === "turn.cancelled";
}
