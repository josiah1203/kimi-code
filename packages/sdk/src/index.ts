export { SpiderByteHarness } from '#/spiderbyte-harness';
export type { SpiderByteHarnessRuntimeOptions } from '#/spiderbyte-harness';
export { Session } from '#/session';
export type { SessionOptions, SessionPlatformEventOptions } from '#/session';
export type { PlatformLifecycleEvent } from '@spiderbyte/protocol';

export { SpiderByteAuthFacade } from '#/auth';
export type {
  SpiderByteAuthLogoutResult,
} from '#/auth';

export {
  createSpiderByteHarness,
  SpiderByteSdkClient,
  type SpiderByteSdkClientOptions,
} from '#/spiderbyte-sdk-client';

export {
  createSpiderByteConfigRpc,
  SpiderByteConfigRpcClient,
  type SpiderByteConfigRpc,
  type SpiderByteConfigValidationIssue,
  type SpiderByteConfigValidationPathSegment,
  type ResolveSpiderByteConfigPathInput,
  type ValidateSpiderByteConfigTomlInput,
} from '#/config-rpc';
export { removeProviderFromConfig } from '#/v2/config-mapper';
export { limitAgentReplayByTurns } from '#/v2/resume-replay';

export * from '#/catalog';
export * from '#/platform';
export * from '#/events';
export type * from '#/types';
export * from '#/errors';
import { spiderByteErrorInfo, type SpiderByteErrorInfo, type SpiderByteErrorCode } from '#/errors';
export const SPIDERBYTE_ERROR_INFO = new Proxy({} as Record<string, SpiderByteErrorInfo>, {
  get: (_target, code: string) => spiderByteErrorInfo(code as SpiderByteErrorCode),
});

export { ImageLimits } from '#/image-limits';
export {
  buildImageCompressionCaption,
  buildUnsupportedImageNotice,
  compressImageForModel,
  compressBase64ForModel,
  gateImageFormatParts,
  isModelAcceptedImageMime,
  normalizeImageMime,
  parseImageDataUrl,
  persistOriginalImage,
  sessionMediaOriginalsDir,
  IMAGE_BYTE_BUDGET,
  MAX_IMAGE_EDGE_PX,
} from '@spiderbyte/agent-core';
export type {
  CompressImageOptions,
  CompressImageResult,
  ImageCompressionTelemetry,
} from '@spiderbyte/agent-core/agent/media/image-compress';

export {
  flushDiagnosticLogs,
  flushDiagnosticLogsSync,
  effectiveModelAlias,
  installGlobalProxyDispatcher,
  loadRuntimeConfigSafe,
  log,
  parseAgentFileText,
  redact,
  resolveAgentPath,
  resolveConfigPath,
  resolveGlobalLogPath,
  resolveSpiderByteHome,
} from '#/host-utils';
export type { Logger, RuntimeConfigLoadResult } from '#/host-utils';
export { SECONDARY_DERIVED_MODEL_ID as SECONDARY_DERIVED_MODEL_ALIAS } from '@spiderbyte/agent-core';

export type {
  ExperimentalFeatureState,
  ExperimentalFlagMap,
  ExperimentalFlagSource,
} from '@spiderbyte/agent-core/app/flag/flag';
export type { FlagId, FlagSurface } from '@spiderbyte/agent-core/app/flag/flagRegistry';
