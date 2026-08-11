export {
  DeviceCodeExpiredError,
  DeviceCodeTimeoutError,
  OAuthConnectionError,
  OAuthError,
  OAuthUnauthorizedError,
  RetryableRefreshError,
} from './errors';

export type {
  DeviceAuthorization,
  DeviceHeaders,
  OAuthFlowConfig,
  OAuthStorageBackend,
  TokenInfo,
  TokenInfoWire,
} from './types';
export { tokenFromWire, tokenToWire } from './types';

export type { TokenStorage } from './storage';
export { FileTokenStorage } from './storage';

export type { DevicePollResult, RefreshOptions } from './oauth';
export { pollDeviceToken, refreshAccessToken, requestDeviceAuthorization } from './oauth';

export type { LoginOptions, OAuthManagerOptions, OAuthRefreshOutcome } from './oauth-manager';
export { OAuthManager, defaultRefreshThreshold, newInstanceId } from './oauth-manager';

export {
  assertSpiderByteHostIdentity,
  createSpiderByteDefaultHeaders,
  createSpiderByteDeviceHeaders,
  createSpiderByteDeviceId,
  createSpiderByteUserAgent,
  parseSpiderByteCustomHeaders,
  readSpiderByteDeviceId,
  replaceUserAgentProduct,
  SPIDERBYTE_CUSTOM_HEADERS_ENV,
  SPIDERBYTE_PLATFORM,
} from './identity';
export type { SpiderByteHostIdentity, SpiderByteIdentityOptions } from './identity';

export type {
  ProviderConfigShape,
  ProviderModelAlias,
  ProviderModelInfo,
  ProviderOAuthRef,
  SpiderByteConfigShape,
} from './config';

export {
  applyOpenPlatformConfig,
  capabilitiesForModel,
  fetchOpenPlatformModels,
  filterModelsByPrefix,
  getOpenPlatformById,
  isOpenPlatformId,
  OPEN_PLATFORMS,
  OpenPlatformApiError,
  removeOpenPlatformConfig,
} from './open-platform';
export type { ApplyOpenPlatformResult, OpenPlatformDefinition } from './open-platform';

export {
  applyCustomRegistryEntries,
  applyCustomRegistryProvider,
  capabilitiesFromCustomEntry,
  CustomRegistryApiError,
  CUSTOM_REGISTRY_DEFAULT_CAPABILITIES,
  CUSTOM_REGISTRY_DEFAULT_MAX_CONTEXT,
  fetchCustomRegistry,
  removeCustomRegistryProvider,
} from './custom-registry';
export type {
  CustomRegistryModelEntry,
  CustomRegistryProviderEntry,
  CustomRegistryProviderType,
  CustomRegistrySource,
  FetchCustomRegistryOptions,
} from './custom-registry';

export { SpiderByteOAuthToolkit, resolveOAuthTokenStorageName } from './toolkit';
export type {
  AuthProviderStatus,
  AuthStatus,
  BearerTokenProvider,
  SpiderByteOAuthLoginOptions,
  SpiderByteOAuthLoginResult,
  SpiderByteOAuthLogoutResult,
  SpiderByteOAuthTokenRef,
  SpiderByteOAuthToolkitOptions,
} from './toolkit';

export { refreshProviderModels } from './refreshProviderModels';
export type {
  ProviderChange,
  RefreshProviderHost,
  RefreshProviderOptions,
  RefreshProviderScope,
  RefreshResult,
} from './refreshProviderModels';
