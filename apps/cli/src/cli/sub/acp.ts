/**
 * Canonical `spyderbyte acp` command.
 *
 * ACP is served by the local SpiderByte Agent Core through
 * `@spiderbyte/acp-server`. The former v1 harness adapter is intentionally
 * not part of the supported CLI graph.
 */

export { registerNativeAcpCommand as registerAcpCommand } from './acp-native';
