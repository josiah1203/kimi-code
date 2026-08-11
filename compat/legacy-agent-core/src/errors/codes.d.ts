/**
 * Error codes for Kimi Core's public error protocol.
 *
 * `ErrorCodes` is the source of truth for every code Kimi Core may emit.
 * Downstream consumers (SDK, RPC clients, telemetry, agent-facing docs)
 * should depend on these string values rather than on class identity.
 *
 * Codes follow `domain.reason`. Adding a code is a minor change; renaming
 * or removing one is a major change.
 */
export declare const ErrorCodes: {
    readonly CONFIG_INVALID: "config.invalid";
    readonly SESSION_NOT_FOUND: "session.not_found";
    readonly SESSION_ALREADY_EXISTS: "session.already_exists";
    readonly SESSION_ID_INVALID: "session.id_invalid";
    readonly SESSION_ID_REQUIRED: "session.id_required";
    readonly SESSION_ID_EMPTY: "session.id_empty";
    readonly SESSION_TITLE_EMPTY: "session.title_empty";
    readonly SESSION_STATE_NOT_FOUND: "session.state_not_found";
    readonly SESSION_STATE_INVALID: "session.state_invalid";
    readonly SESSION_FORK_ACTIVE_TURN: "session.fork_active_turn";
    readonly SESSION_EXPORT_NOT_FOUND: "session.export_not_found";
    readonly SESSION_EXPORT_MISSING_VERSION: "session.export_missing_version";
    readonly SESSION_CLOSED: "session.closed";
    readonly SESSION_PERMISSION_MODE_INVALID: "session.permission_mode_invalid";
    readonly SESSION_THINKING_EMPTY: "session.thinking_empty";
    readonly SESSION_MODEL_EMPTY: "session.model_empty";
    readonly SESSION_PLAN_MODE_INVALID: "session.plan_mode_invalid";
    readonly SESSION_APPROVAL_HANDLER_ERROR: "session.approval_handler_error";
    readonly SESSION_QUESTION_HANDLER_ERROR: "session.question_handler_error";
    readonly SESSION_INIT_FAILED: "session.init_failed";
    readonly AGENT_NOT_FOUND: "agent.not_found";
    readonly TURN_AGENT_BUSY: "turn.agent_busy";
    readonly GOAL_ALREADY_EXISTS: "goal.already_exists";
    readonly GOAL_NOT_FOUND: "goal.not_found";
    readonly GOAL_OBJECTIVE_EMPTY: "goal.objective_empty";
    readonly GOAL_OBJECTIVE_TOO_LONG: "goal.objective_too_long";
    readonly GOAL_STATUS_INVALID: "goal.status_invalid";
    readonly GOAL_METADATA_RESERVED: "goal.metadata_reserved";
    readonly GOAL_NOT_RESUMABLE: "goal.not_resumable";
    readonly MODEL_NOT_CONFIGURED: "model.not_configured";
    readonly MODEL_CONFIG_INVALID: "model.config_invalid";
    readonly AUTH_LOGIN_REQUIRED: "auth.login_required";
    readonly CONTEXT_OVERFLOW: "context.overflow";
    readonly LOOP_MAX_STEPS_EXCEEDED: "loop.max_steps_exceeded";
    readonly PROVIDER_API_ERROR: "provider.api_error";
    readonly PROVIDER_FILTERED: "provider.filtered";
    readonly PROVIDER_RATE_LIMIT: "provider.rate_limit";
    readonly PROVIDER_AUTH_ERROR: "provider.auth_error";
    readonly PROVIDER_CONNECTION_ERROR: "provider.connection_error";
    readonly SKILL_NOT_FOUND: "skill.not_found";
    readonly SKILL_TYPE_UNSUPPORTED: "skill.type_unsupported";
    readonly SKILL_NAME_EMPTY: "skill.name_empty";
    readonly RECORDS_WRITE_FAILED: "records.write_failed";
    readonly COMPACTION_FAILED: "compaction.failed";
    readonly COMPACTION_UNABLE: "compaction.unable";
    readonly BACKGROUND_TASK_ID_EMPTY: "task.task_id_empty";
    readonly MCP_SERVER_NOT_FOUND: "mcp.server_not_found";
    readonly MCP_SERVER_DISABLED: "mcp.server_disabled";
    readonly MCP_STARTUP_FAILED: "mcp.startup_failed";
    readonly MCP_TOOL_NAME_COLLISION: "mcp.tool_name_collision";
    readonly PLUGIN_NOT_FOUND: "plugin.not_found";
    readonly PLUGIN_LOAD_FAILED: "plugin.load_failed";
    readonly REQUEST_INVALID: "request.invalid";
    readonly REQUEST_WORK_DIR_REQUIRED: "request.work_dir_required";
    readonly REQUEST_PROMPT_INPUT_EMPTY: "request.prompt_input_empty";
    readonly SHELL_GIT_BASH_NOT_FOUND: "shell.git_bash_not_found";
    readonly NOT_IMPLEMENTED: "not_implemented";
    readonly INTERNAL: "internal";
};
export type KimiErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
export interface KimiErrorInfo {
    readonly title: string;
    readonly retryable: boolean;
    /**
     * Whether the code is a stable public contract. `false` reserves the
     * right to rename or remove without a major version bump.
     */
    readonly public: boolean;
    readonly action?: string;
}
export declare const KIMI_ERROR_INFO: {
    readonly 'config.invalid': {
        readonly title: "Invalid configuration";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Check config.toml and provider/model settings.";
    };
    readonly 'session.not_found': {
        readonly title: "Session not found";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Check the session id or list available sessions.";
    };
    readonly 'session.already_exists': {
        readonly title: "Session already exists";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Use a different session id or remove the existing session first.";
    };
    readonly 'session.id_invalid': {
        readonly title: "Invalid session id";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Use a session id without path-traversal characters.";
    };
    readonly 'session.id_required': {
        readonly title: "Session id required";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Provide a session id when calling this method.";
    };
    readonly 'session.id_empty': {
        readonly title: "Session id is empty";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Provide a non-empty session id.";
    };
    readonly 'session.title_empty': {
        readonly title: "Session title is empty";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Provide a non-empty session title.";
    };
    readonly 'session.state_not_found': {
        readonly title: "Session state missing";
        readonly retryable: false;
        readonly public: true;
        readonly action: "The session directory is corrupted or missing state.json.";
    };
    readonly 'session.state_invalid': {
        readonly title: "Session state invalid";
        readonly retryable: false;
        readonly public: true;
        readonly action: "The session state.json is corrupted; remove the session or repair the file.";
    };
    readonly 'session.fork_active_turn': {
        readonly title: "Cannot fork session during active turn";
        readonly retryable: true;
        readonly public: true;
        readonly action: "Wait for the active turn to complete before forking.";
    };
    readonly 'session.export_not_found': {
        readonly title: "Session export directory missing";
        readonly retryable: false;
        readonly public: true;
        readonly action: "The session has not been persisted to disk yet.";
    };
    readonly 'session.export_missing_version': {
        readonly title: "Export version is missing";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Provide a version when exporting the session.";
    };
    readonly 'session.closed': {
        readonly title: "Session is closed";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Create a new session.";
    };
    readonly 'session.permission_mode_invalid': {
        readonly title: "Invalid permission mode";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Use one of: yolo / manual / auto.";
    };
    readonly 'session.thinking_empty': {
        readonly title: "Thinking value is empty";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Provide a non-empty thinking option.";
    };
    readonly 'session.model_empty': {
        readonly title: "Model is empty";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Provide a non-empty model identifier.";
    };
    readonly 'session.plan_mode_invalid': {
        readonly title: "Invalid plan mode";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Provide a boolean plan mode.";
    };
    readonly 'session.approval_handler_error': {
        readonly title: "Approval handler threw";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Inspect the SDK approval handler for an unhandled exception.";
    };
    readonly 'session.question_handler_error': {
        readonly title: "Question handler threw";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Inspect the SDK question handler for an unhandled exception.";
    };
    readonly 'session.init_failed': {
        readonly title: "Session init failed";
        readonly retryable: false;
        readonly public: false;
        readonly action: "Review the init failure details and try again.";
    };
    readonly 'agent.not_found': {
        readonly title: "Agent not found";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Check the agent id or list available agents.";
    };
    readonly 'turn.agent_busy': {
        readonly title: "Agent is busy";
        readonly retryable: true;
        readonly public: true;
        readonly action: "Wait for the current turn to finish or steer it.";
    };
    readonly 'goal.already_exists': {
        readonly title: "A goal is already active";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Use `/goal replace <objective>` to replace the current goal.";
    };
    readonly 'goal.not_found': {
        readonly title: "No goal found";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Start a goal with `/goal <objective>` first.";
    };
    readonly 'goal.objective_empty': {
        readonly title: "Goal objective is empty";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Provide a non-empty objective.";
    };
    readonly 'goal.objective_too_long': {
        readonly title: "Goal objective is too long";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Keep the objective under 4000 characters; reference long details by file path.";
    };
    readonly 'goal.status_invalid': {
        readonly title: "Invalid goal status transition";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Use a status allowed for this actor (complete, blocked, or impossible).";
    };
    readonly 'goal.metadata_reserved': {
        readonly title: "Goal metadata is reserved";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Do not write metadata.custom.goal directly; use the goal lifecycle methods.";
    };
    readonly 'goal.not_resumable': {
        readonly title: "Goal is not resumable";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Only paused goals can be resumed.";
    };
    readonly 'model.not_configured': {
        readonly title: "No model configured";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Set a default model in config.toml or via setModel.";
    };
    readonly 'model.config_invalid': {
        readonly title: "Invalid model configuration";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Check the model and provider entries in config.toml.";
    };
    readonly 'auth.login_required': {
        readonly title: "Login required";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Run the login flow for the provider before retrying.";
    };
    readonly 'context.overflow': {
        readonly title: "Context window overflow";
        readonly retryable: true;
        readonly public: true;
        readonly action: "Compact the conversation or start a new session.";
    };
    readonly 'loop.max_steps_exceeded': {
        readonly title: "Turn exceeded max steps";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Increase loop_control.max_steps_per_turn in config.toml or split the task.";
    };
    readonly 'provider.api_error': {
        readonly title: "Provider API error";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Inspect details.statusCode / details.requestId; check provider status.";
    };
    readonly 'provider.filtered': {
        readonly title: "Provider filtered response";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Revise the prompt or model configuration to avoid provider safety filtering.";
    };
    readonly 'provider.rate_limit': {
        readonly title: "Provider rate limit";
        readonly retryable: true;
        readonly public: true;
        readonly action: "Retry after a delay or reduce request frequency.";
    };
    readonly 'provider.auth_error': {
        readonly title: "Provider authentication error";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Re-authenticate with the provider.";
    };
    readonly 'provider.connection_error': {
        readonly title: "Provider connection error";
        readonly retryable: true;
        readonly public: true;
        readonly action: "Check network connectivity and retry.";
    };
    readonly 'skill.not_found': {
        readonly title: "Skill not found";
        readonly retryable: false;
        readonly public: true;
        readonly action: "List available skills via the skill registry.";
    };
    readonly 'skill.type_unsupported': {
        readonly title: "Skill type not supported";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Only inline skills can be activated by the user.";
    };
    readonly 'skill.name_empty': {
        readonly title: "Skill name is empty";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Provide a non-empty skill name.";
    };
    readonly 'records.write_failed': {
        readonly title: "Failed to write records";
        readonly retryable: true;
        readonly public: true;
        readonly action: "Check disk space and permissions on the session directory.";
    };
    readonly 'compaction.failed': {
        readonly title: "Compaction failed";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Inspect logs and consider increasing compaction limits.";
    };
    readonly 'compaction.unable': {
        readonly title: "Unable to compact";
        readonly retryable: false;
        readonly public: true;
        readonly action: "The current history has no prefix that can be compacted (e.g. only a pending user message). Start a new turn or session instead.";
    };
    readonly 'task.task_id_empty': {
        readonly title: "Background task id is empty";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Provide a non-empty task id.";
    };
    readonly 'mcp.server_not_found': {
        readonly title: "MCP server not found";
        readonly retryable: false;
        readonly public: true;
        readonly action: "List configured MCP servers and check the requested name.";
    };
    readonly 'mcp.server_disabled': {
        readonly title: "MCP server is disabled";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Enable the MCP server entry in config before reconnecting.";
    };
    readonly 'mcp.startup_failed': {
        readonly title: "MCP server startup failed";
        readonly retryable: true;
        readonly public: true;
        readonly action: "Inspect the MCP server log or call reconnect once the server is healthy.";
    };
    readonly 'mcp.tool_name_collision': {
        readonly title: "MCP tool name collision";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Rename one of the colliding MCP tools or servers so their qualified names are unique.";
    };
    readonly 'plugin.not_found': {
        readonly title: "Plugin not found";
        readonly retryable: false;
        readonly public: true;
        readonly action: "List installed plugins via /plugins and check the requested id.";
    };
    readonly 'plugin.load_failed': {
        readonly title: "Plugin state failed to load";
        readonly retryable: true;
        readonly public: true;
        readonly action: "Fix the installed.json file under $KIMI_CODE_HOME/plugins/ and run /plugins reload.";
    };
    readonly 'request.invalid': {
        readonly title: "Invalid request";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Check the input shape matches the API contract.";
    };
    readonly 'request.work_dir_required': {
        readonly title: "workDir is required";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Provide workDir in the request payload.";
    };
    readonly 'request.prompt_input_empty': {
        readonly title: "Prompt input is empty";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Provide non-empty prompt input.";
    };
    readonly 'shell.git_bash_not_found': {
        readonly title: "Git Bash not found";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Install Git for Windows from https://gitforwindows.org/ or set KIMI_SHELL_PATH to a bash.exe.";
    };
    readonly not_implemented: {
        readonly title: "Not implemented";
        readonly retryable: false;
        readonly public: true;
        readonly action: "This feature is not implemented yet.";
    };
    readonly internal: {
        readonly title: "Internal error";
        readonly retryable: false;
        readonly public: true;
        readonly action: "Inspect logs or report the issue with diagnostics.";
    };
};
