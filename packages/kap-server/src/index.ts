/**
 * `@spiderbyte/kap-server` public surface — the SpiderByte server backed by the
 * DI × Scope agent engine (`@spiderbyte/agent-core`).
 */

export { startServer } from './start';
export type { ServerHostIdentity, ServerStartOptions, RunningServer } from './start';
export {
  createSpyderbyteMcpServer,
  SPIDERBYTE_MCP_DEFAULT_TIMEOUT_MS,
  SPIDERBYTE_MCP_MAX_ARTIFACT_BYTES,
  SPIDERBYTE_MCP_MAX_RESULT_TEXT,
  SPIDERBYTE_MCP_PROTOCOL_VERSION,
  SPIDERBYTE_MCP_CURATED_TOOLS,
  SPIDERBYTE_MCP_MAX_CURATED_STRUCTURED_BYTES,
  SPIDERBYTE_MCP_PROFILES,
  SPIDERBYTE_MCP_SERVER_NAME,
  resolveSpyderbyteMcpProfile,
} from './mcp/server';
export type { SpyderbyteMcpOptions, SpyderbyteMcpProfile } from './mcp/server';
export { createSpyderbyteMcpHandler } from './mcp/routes';
export type { RegisterMcpRoutesOptions } from './mcp/routes';
export { okEnvelope, errEnvelope } from './envelope';
export type { Envelope } from './envelope';
export { classify } from './security/bindClassify';
export type { BindClass } from './security/bindClassify';
export { rotateServerToken, serverTokenPath } from './services/auth/persistentToken';
export { createServerLogger } from './services/pinoLoggerService';
export type {
  CreateLoggerOptions,
  ServerLogger,
  ServerLogLevel,
} from './services/pinoLoggerService';
export {
  createInstanceRegistry,
  listLiveServerInstances,
  getLiveServerInstance,
  resolveServerInstancesDir,
  DEFAULT_SERVER_DIR,
  DEFAULT_SERVER_INSTANCES_DIR,
  HEARTBEAT_INTERVAL_MS,
} from './instanceRegistry';
export type {
  IInstanceRegistry,
  InstanceRegistration,
  InstanceRegistryOptions,
  ServerInstanceInfo,
} from './instanceRegistry';
