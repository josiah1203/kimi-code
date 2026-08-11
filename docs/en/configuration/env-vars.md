# Environment variables

Environment variables are explicit overrides for local configuration. They are useful for CI, isolated smoke tests, and BYOK provider setup. SpiderByte never treats an environment variable as permission to contact a hosted SpiderByte service.

## Home and provider selection

| Variable | Purpose |
| --- | --- |
| `SPIDERBYTE_HOME` | Moves the local data and configuration directory. |
| `SPIDERBYTE_MODEL_NAME` | Adds an in-memory model alias for the current process. |
| `SPIDERBYTE_MODEL_PROVIDER_TYPE` | Sets the provider adapter for the environment model. |
| `SPIDERBYTE_MODEL_API_KEY` | Supplies the environment model's API key. |
| `SPIDERBYTE_MODEL_BASE_URL` | Supplies the environment model's endpoint. Required for adapters without a default endpoint. |
| `SPIDERBYTE_MODEL_MAX_CONTEXT_SIZE` | Overrides the environment model context limit. |
| `SPIDERBYTE_MODEL_MAX_OUTPUT_SIZE` | Overrides its output limit. |
| `SPIDERBYTE_MODEL_CAPABILITIES` | Comma-separated capability tags. |
| `SPIDERBYTE_MODEL_TEMPERATURE` | Sets the environment model temperature. |
| `SPIDERBYTE_MODEL_TOP_P` | Sets the environment model nucleus-sampling value. |
| `SPIDERBYTE_MODEL_THINKING_KEEP` | Controls preserved reasoning content. |
| `SPIDERBYTE_MODEL_THINKING_EFFORT` | Sets the model's thinking effort. |
| `SPIDERBYTE_MODEL_REASONING_KEY` | Selects a non-standard reasoning field for compatible gateways. |

Example:

```sh
SPIDERBYTE_MODEL_NAME=your-local-model \
SPIDERBYTE_MODEL_PROVIDER_TYPE=openai \
SPIDERBYTE_MODEL_BASE_URL=http://127.0.0.1:11434/v1 \
SPIDERBYTE_MODEL_API_KEY=local \
spyderbyte
```

The environment overlay is process-local. It is not written back to `config.toml`; use a provider record when the setting should persist.

## Runtime controls

| Variable | Purpose |
| --- | --- |
| `SPIDERBYTE_LOOP_MAX_STEPS_PER_TURN` | Maximum steps in one turn. |
| `SPIDERBYTE_LOOP_MAX_ATTEMPTS_PER_STEP` | Total attempts for a failing step. |
| `SPIDERBYTE_LOOP_MAX_RETRIES_PER_STEP` | Deprecated alias for the attempt limit. |
| `SPIDERBYTE_SECONDARY_MODEL` | Model alias used for secondary-agent work when that feature is enabled. |
| `SPIDERBYTE_SECONDARY_EFFORT` | Thinking effort for the secondary model. |
| `SPIDERBYTE_EXPERIMENTAL_FLAG` | Enables all experimental flags for a development run. |
| `SPIDERBYTE_EXPERIMENTAL_SECONDARY_MODEL` | Enables secondary-model selection. |
| `SPIDERBYTE_DISABLE_CRON` | Disables local scheduled automation. |
| `SPIDERBYTE_DISABLE_PLATFORM_SERVICES` | Disables optional local platform services. |
| `SPIDERBYTE_TUI_NO_RENDER_CACHE` | Disables the terminal render cache. |
| `SPIDERBYTE_STATUS_LINE` | Sets the external status-line command. |

## Logging and diagnostics

| Variable | Purpose |
| --- | --- |
| `SPIDERBYTE_LOG_LEVEL` | Sets the log level. |
| `SPIDERBYTE_LOG_SESSION_FILES` | Enables per-session log files. |
| `SPIDERBYTE_LOG_GLOBAL_FILES` | Enables process-level log files. |
| `SPIDERBYTE_DEBUG` | Enables additional local diagnostics. |
| `SPIDERBYTE_STARTUP_TRACE` | Writes startup timing information. |
| `SPIDERBYTE_ERROR_INFO` | Requests expanded startup error information. |

Logs are written below `SPIDERBYTE_HOME` and should be inspected for secrets before sharing.

## Plugins, MCP, and updates

| Variable | Purpose |
| --- | --- |
| `SPIDERBYTE_PLUGIN_ROOT` | Root supplied to a plugin subprocess. |
| `SPIDERBYTE_PLUGIN_MARKETPLACE_URL` | Explicit plugin catalog URL or local path. A blank value does not enable a default hosted catalog. |
| `SPIDERBYTE_MCP_STARTUP_TIMEOUT_MS` | MCP startup timeout. |
| `SPIDERBYTE_MCP_TOOL_TIMEOUT_MS` | MCP tool-call timeout. |
| `SPIDERBYTE_CLI_NO_AUTO_UPDATE` | Disables CLI update checks. |
| `SPIDERBYTE_NO_AUTO_UPDATE` | Compatibility alias for disabling update checks. |
| `SPIDERBYTE_CDN_LATEST_URL` | Explicit update metadata URL when update checks are enabled. |

Remote plugin catalogs and update endpoints are optional integrations. They are not required for local accountless operation.

## Security guidance

Do not commit API keys, OAuth tokens, bearer tokens, or signed URLs. Use `YOUR_API_KEY` in documentation and tests. For CI, provide secrets through the CI secret store and keep the provider endpoint explicit. A missing or unavailable optional capability must produce a documented error; it must not fall back to a legacy product path.
