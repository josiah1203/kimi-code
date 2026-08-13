import {
  applyOpenPlatformConfig,
  fetchOpenPlatformModels,
  filterModelsByPrefix,
  getOpenPlatformById,
  OpenPlatformApiError,
  type ProviderModelInfo,
  type SpiderByteConfigShape,
  type OpenPlatformDefinition,
} from '@spiderbyte/oauth';
import type { ChoiceOption } from '../components/dialogs/choice-picker';
import { formatErrorMessage } from '../utils/event-payload';
import {
  promptApiKey,
  promptDisconnectProviderSelection,
  promptModelSelectionForOpenPlatform,
  promptPlatformSelection,
} from './prompts';
import type { SlashCommandHost } from './dispatch';

// ---------------------------------------------------------------------------
// Local/BYOK provider setup and disconnect
// ---------------------------------------------------------------------------

export async function handleConnectCommand(host: SlashCommandHost): Promise<void> {
  const platformId = await promptPlatformSelection(host);
  if (platformId === undefined) return;

  const platform = getOpenPlatformById(platformId);
  if (platform === undefined) return;
  await handleOpenPlatformSetup(host, platform);
}

async function handleOpenPlatformSetup(
  host: SlashCommandHost,
  platform: OpenPlatformDefinition,
): Promise<void> {
  const platformName = platform.name;
  const subtitleLines = [
    `${'base_url'.padEnd(12)}${platform.baseUrl}`,
    `${'saved to'.padEnd(12)}~/.spiderbyte/config.toml`,
  ];
  const apiKey = await promptApiKey(host, platformName, subtitleLines);
  if (apiKey === undefined) return;

  const controller = new AbortController();
  const cancelSetup = (): void => {
    controller.abort();
  };
  host.cancelInFlight = cancelSetup;

  let models: ProviderModelInfo[];
  try {
    models = await fetchOpenPlatformModels(platform, apiKey, fetch, controller.signal);
    models = filterModelsByPrefix(models, platform);
  } catch (error) {
    if (controller.signal.aborted) return;
    const msg = formatErrorMessage(error);
    host.showError(`Failed to verify API key: ${msg}`);
    if (
      error instanceof OpenPlatformApiError &&
      error.status === 401
    ) {
      host.showStatus('Hint: verify the API key and select the matching external provider.');
    }
    return;
  } finally {
    if (host.cancelInFlight === cancelSetup) {
      host.cancelInFlight = undefined;
    }
  }

  if (models.length === 0) {
    host.showError('No models available for this platform.');
    return;
  }

  const selection = await promptModelSelectionForOpenPlatform(host, models, platform);
  if (selection === undefined) return;

  const existingConfig = await host.harness.getConfig();
  const existingSecretRef = existingConfig.providers[platform.id]?.secretRef;
  if (existingConfig.providers[platform.id] !== undefined) {
    await host.harness.removeProvider(platform.id);
  }

  const config = await host.harness.getConfig();
  const secretRef = await host.harness.storeProviderSecret(apiKey, existingSecretRef);
  applyOpenPlatformConfig(config as SpiderByteConfigShape, {
    platform,
    models,
    selectedModel: selection.model,
    thinking: selection.thinking !== 'off',
    effort:
      selection.thinking !== 'off' && selection.thinking !== 'on'
        ? selection.thinking
        : undefined,
    apiKey,
    secretRef,
  });

  await host.harness.setConfig({
    providers: config.providers,
    models: config.models,
    defaultModel: config.defaultModel,
    thinking: config.thinking,
  });

  await host.authFlow.refreshConfigAfterProviderConfiguration();
  host.track('provider_setup', { provider: platform.id, method: 'api_key' });
  host.showStatus(`Setup complete: ${platform.name} · ${selection.model.id}`);
}

export async function handleDisconnectCommand(host: SlashCommandHost): Promise<void> {
  const config = await host.harness.getConfig();
  const providerIds = Object.keys(config.providers ?? {}).toSorted();

  const options: ChoiceOption[] = [];
  for (const id of providerIds) {
    const baseUrl = config.providers[id]?.baseUrl;
    options.push({
      value: id,
      label: id,
      description: typeof baseUrl === 'string' && baseUrl.length > 0 ? baseUrl : undefined,
    });
  }

  if (options.length === 0) {
    host.showStatus('No configured provider to disconnect.');
    return;
  }

  const currentModel = host.state.appState.model.trim();
  const currentProvider = host.state.appState.availableModels[currentModel]?.provider;

  const target = await promptDisconnectProviderSelection(host, options, currentProvider);
  if (target === undefined) return;

  await host.harness.removeProvider(target);

  if (target === currentProvider) {
    await host.authFlow.refreshConfigAfterProviderDisconnect();
    await host.authFlow.clearActiveSessionAfterDisconnect();
  } else {
    const updated = await host.harness.getConfig({ reload: true });
    host.setAppState({
      availableModels: updated.models ?? {},
      availableProviders: updated.providers ?? {},
    });
  }

  host.track('disconnect', { provider: target });
  host.showStatus(`Disconnected from ${target}.`);
}
