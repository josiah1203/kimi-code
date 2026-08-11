import { ErrorCodes } from '@spiderbyte/sdk';

export const PRODUCT_NAME = 'SpiderByte';
export const PRIMARY_CLI_COMMAND_NAME = 'spyderbyte';
export const CLI_COMMAND_NAME = PRIMARY_CLI_COMMAND_NAME;
export const PROCESS_NAME = 'spyderbyte';

// Public product links are kept in one place so the compatibility executable
// and future clients cannot accidentally become the documented authority.
// Replace the .example hosts when the SpiderByte public properties are ready.
export const SPIDERBYTE_DOCS_URL = 'https://docs.spyderbyte.example';
export const SPIDERBYTE_SUPPORT_URL = 'https://support.spyderbyte.example';
export const SPIDERBYTE_UPDATE_URL = 'https://updates.spyderbyte.example';

// Used in telemetry app names and HTTP User-Agent headers.
export const CLI_USER_AGENT_PRODUCT = 'spyderbyte-cli';
export const CLI_UI_MODE = 'shell';
// Telemetry ui_mode for the `spyderbyte web` host. Same product
// as the CLI (CLI_USER_AGENT_PRODUCT); the surface is distinguished by ui_mode.
export const WEB_UI_MODE = 'web';
// User-Agent suffix for the `spyderbyte web` host: its requests go out as
// `spyderbyte-cli/<version> (web)` so upstream can tell web-UI traffic
// apart from direct CLI runs without changing the product token or platform.
export const WEB_USER_AGENT_SUFFIX = 'web';

// Give telemetry a short flush window without making CLI exit feel stuck.
export const CLI_SHUTDOWN_TIMEOUT_MS = 3000;

// Upper bound on headless (`spyderbyte -p`) shutdown. A wedged cleanup step (e.g. a
// SessionEnd hook, an MCP shutdown, or a connection blackholed by a restrictive
// firewall) must not keep a completed run alive indefinitely — once this elapses
// we stop waiting on cleanup and let the run return.
export const PROMPT_CLEANUP_TIMEOUT_MS = 8000;

// Grace after a headless run has fully completed (turn done, cleanup attempted)
// before force-exiting. `spyderbyte -p` otherwise relies on the event loop draining to
// exit; a stray ref'd handle (socket/timer/child) left over from the run would
// wedge it. The guard timer is unref'd, so a healthy run still exits naturally
// well before this fires.
export const HEADLESS_FORCE_EXIT_GRACE_MS = 2000;

// Max time to wait for buffered stdout/stderr to flush before arming the
// force-exit fallback. A slow/piped consumer's still-draining stdio is a
// legitimate ref'd handle — flushing first prevents the fallback from
// truncating completed output. Bounded so a permanently-stuck consumer can't
// re-introduce the hang.
export const HEADLESS_STDIO_DRAIN_TIMEOUT_MS = 10000;

// Published npm package name; this can differ from the executable command.
export const NPM_PACKAGE_NAME = '@spiderbyte/cli';

// App-owned data paths. SDK/core runtime config is intentionally not routed here.
export const SPIDERBYTE_HOME_ENV = 'SPIDERBYTE_HOME';
export const SPIDERBYTE_DATA_DIR_NAME = '.spiderbyte';
export const SPIDERBYTE_LOG_DIR_NAME = 'logs';
export const SPIDERBYTE_CACHE_DIR_NAME = 'cache';
export const SPIDERBYTE_UPDATE_DIR_NAME = 'updates';
export const SPIDERBYTE_BIN_DIR_NAME = 'bin';
export const SPIDERBYTE_UPDATE_STATE_FILE_NAME = 'latest.json';
export const SPIDERBYTE_UPDATE_INSTALL_STATE_FILE_NAME = 'install.json';
export const SPIDERBYTE_UPDATE_INSTALL_LOCK_FILE_NAME = 'install.lock';
export const SPIDERBYTE_UPDATE_ROLLOUT_LOG_FILE_NAME = 'rollout.log';
export const SPIDERBYTE_PLUGIN_UPDATE_NOTICE_STATE_FILE_NAME = 'plugin-notices.json';
export const SPIDERBYTE_INPUT_HISTORY_DIR_NAME = 'user-history';
export const SPIDERBYTE_BANNER_DIR_NAME = 'banner';
export const SPIDERBYTE_BANNER_STATE_FILE_NAME = 'state.json';

// SDK/core error code retained for stable local capability errors. Hosted
// identity login is not part of Open Core and has no active CLI path.
export const PROVIDER_CONFIGURATION_REQUIRED_CODE = ErrorCodes.AUTH_LOGIN_REQUIRED;

// CDN source of truth: all version checks and native install scripts pull from here.
export const SPIDERBYTE_CDN_BASE = process.env['SPIDERBYTE_CDN_BASE'] ?? '';
export const SPIDERBYTE_CDN_LATEST_URL = `${SPIDERBYTE_CDN_BASE}/latest`;
// Rollout manifest consumed by update checks; the plain-text `/latest` above
// stays unchanged forever — already-shipped clients hard-fail on non-semver
// bodies, and the CDN install scripts read it for fresh installs.
export const SPIDERBYTE_CDN_LATEST_JSON_URL = `${SPIDERBYTE_CDN_BASE}/latest.json`;
export const SPIDERBYTE_TIPS_BANNER_URL = process.env['SPIDERBYTE_TIPS_BANNER_URL'] ?? '';
export const SPIDERBYTE_PLUGIN_MARKETPLACE_URL = `${SPIDERBYTE_CDN_BASE}/plugins/marketplace.json`;
export const SPIDERBYTE_PLUGIN_MARKETPLACE_URL_ENV = 'SPIDERBYTE_PLUGIN_MARKETPLACE_URL';
export const SPIDERBYTE_INSTALL_SH_URL = `${SPIDERBYTE_CDN_BASE}/install.sh`;
export const SPIDERBYTE_INSTALL_PS1_URL = `${SPIDERBYTE_CDN_BASE}/install.ps1`;
// Official download page, referenced by prompt copy that steers users away
// from third-party install sources.
export const SPIDERBYTE_OFFICIAL_INSTALL_URL = process.env['SPIDERBYTE_OFFICIAL_INSTALL_URL'] ?? '';

// Native install commands, split by platform. Use these for prompt copy and spawn calls only; do not assemble the strings elsewhere.
export const NATIVE_INSTALL_COMMAND_UNIX = `curl -fsSL ${SPIDERBYTE_INSTALL_SH_URL} | bash`;
export const NATIVE_INSTALL_COMMAND_WIN = `irm ${SPIDERBYTE_INSTALL_PS1_URL} | iex`;
