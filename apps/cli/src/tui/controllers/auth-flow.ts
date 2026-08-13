import {
  removeProviderFromConfig,
  type SpiderByteConfig,
  type SpiderByteHarness,
  type Session,
  type ThinkingEffort,
} from '@spiderbyte/sdk';
import type { ProviderSecretRef } from '@spiderbyte/protocol';

import { createSpiderByteUserAgent } from '#/cli/version';

import type { SkillListSession } from '../commands';

import { PROVIDER_CONFIGURATION_REQUIRED_NOTICE } from '../constant/spiderbyte-tui';
import {
  refreshAllProviderModels,
  type RefreshProviderHost,
  type RefreshResult,
} from '../utils/refresh-providers';
import { thinkingEffortFromConfig } from '../utils/thinking-config';
import type { AppState, SpiderByteTUIOptions } from '../types';
import type { TUIState } from '../tui-state';

export interface AuthFlowHost {
  state: TUIState;
  session: Session | undefined;
  readonly harness: SpiderByteHarness;
  readonly options: SpiderByteTUIOptions;

  setAppState(patch: Partial<AppState>): void;
  setStartupReady(): void;
  resetSessionRuntime(): void;
  closeSession(reason: string): Promise<void>;
  appendStartupNotice(extra: string): void;
  hydrateLazyConfigDefaults(): Promise<void>;
  refreshSkillCommands(session?: SkillListSession): Promise<void>;
  refreshPluginCommands(session?: Session): Promise<void>;
}

export class AuthFlowController {
  constructor(private readonly host: AuthFlowHost) {}

  async refreshAvailableModels(): Promise<void> {
    const config = await this.host.harness.getConfig({ reload: true });
    this.host.setAppState({
      availableModels: config.models ?? {},
      availableProviders: config.providers ?? {},
    });
  }

  enterProviderConfigurationRequiredStartupState(): void {
    this.host.resetSessionRuntime();
    this.host.setAppState({
      sessionId: '',
      model: '',
      thinkingEffort: 'off',
      contextTokens: 0,
      maxContextTokens: 0,
      contextUsage: 0,
      sessionTitle: null,
    });
    this.host.appendStartupNotice(PROVIDER_CONFIGURATION_REQUIRED_NOTICE);
    this.host.setStartupReady();
  }

  async activateModel(model: string, effort?: string): Promise<void> {
    const { host } = this;
    if (host.session !== undefined) {
      await host.session.setModel(model);
      if (effort !== undefined) {
        await host.session.setThinking(effort);
      }
      return;
    }

    // Session-less startup is canonical: configure the model now and carry a
    // one-turn thinking override into the first lazy-created session.
    const patch: Partial<AppState> = { model };
    if (effort !== undefined) {
      patch.thinkingEffort = effort as ThinkingEffort;
      patch.lazySessionThinking = effort as ThinkingEffort;
    }
    host.setAppState(patch);
  }

  async clearActiveSessionAfterDisconnect(): Promise<void> {
    await this.host.closeSession('logged out');
    this.host.resetSessionRuntime();
    this.host.setAppState({
      sessionId: '',
      model: '',
      sessionTitle: null,
    });
    await this.host.refreshSkillCommands();
    await this.host.refreshPluginCommands();
  }

  async refreshConfigAfterProviderConfiguration(): Promise<void> {
    const { host } = this;
    const config = await host.harness.getConfig({ reload: true });
    const availableModels = config.models ?? {};
    const availableProviders = config.providers ?? {};
    const defaultModel = host.options.startup.model ?? config.defaultModel;
    const selected = defaultModel !== undefined ? availableModels[defaultModel] : undefined;

    if (defaultModel === undefined || selected === undefined) {
      if (host.session === undefined) {
        // Hydrate permission/plan defaults even without a default model.
        await host.hydrateLazyConfigDefaults();
      }
      host.setAppState({ availableModels, availableProviders });
      return;
    }

    await this.activateModel(defaultModel, thinkingEffortFromConfig(config.thinking));
    if (host.session === undefined) {
      // Session-less startup also hydrates permission/plan defaults.
      await host.hydrateLazyConfigDefaults();
      host.setAppState({ availableModels, availableProviders });
      return;
    }
    const appStatePatch: Partial<AppState> = {
      availableModels,
      availableProviders,
      model: defaultModel,
      maxContextTokens: selected.maxContextSize,
    };
    host.setAppState(appStatePatch);
  }

  async refreshConfigAfterProviderDisconnect(): Promise<void> {
    const config = await this.host.harness.getConfig({ reload: true });
    this.host.setAppState({
      availableModels: config.models ?? {},
      availableProviders: config.providers ?? {},
      model: '',
      thinkingEffort: 'off',
      maxContextTokens: 0,
      contextUsage: 0,
      contextTokens: 0,
    });
  }

  /**
   * Re-fetch model lists from every provider whose upstream supports it
   * (BYOK and custom registries) and update local
   * config.  Runs best-effort: individual provider failures are collected
   * and returned instead of thrown.
   */
  async refreshProviderModels(): Promise<RefreshResult> {
    return this.refreshProviderModelsWithScope();
  }

  private async refreshProviderModelsWithScope(): Promise<RefreshResult> {
    const result = await refreshAllProviderModels(this.buildRefreshHost(), { scope: 'all' });
    if (result.changed.length > 0) {
      await this.refreshAvailableModels();
    }
    return result;
  }

  /**
   * Build the refresh orchestrator's persistence host. Provider replacement
   * is staged in memory and persisted through the canonical section-replace
   * operation so a process exit cannot leave a partially refreshed config.
   */
  private buildRefreshHost(): RefreshProviderHost {
    const { host } = this;
    const userAgent = createSpiderByteUserAgent();
    let staged: SpiderByteConfig | undefined;
    const requireStaged = (): SpiderByteConfig => {
      if (staged === undefined) {
        throw new Error('refresh host: getConfig must be called before writes');
      }
      return staged;
    };
    return {
      getConfig: async () => {
        staged = await host.harness.getConfig({ reload: true });
        return staged;
      },
      removeProvider: (id) => {
        staged = removeProviderFromConfig(requireStaged(), id);
        return Promise.resolve(staged);
      },
      setConfig: async (patch) => {
        // The orchestrator always passes complete records (built from a full
        // clone), so the Partial-shaped patch is a full SpiderByteConfig overlay.
        staged = { ...requireStaged(), ...patch } as SpiderByteConfig;
        // Object.entries keeps keys whose value is `undefined`, so a cleared
        // section (e.g. a dangling defaultModel) is expressed as a removal in
        // the atomic write; sections absent from the patch stay untouched.
        await host.harness.replaceConfigSections(Object.fromEntries(Object.entries(patch)));
        return staged;
      },
      resolveSecretRef: (secretRef) =>
        host.harness.resolveProviderSecret(secretRef as ProviderSecretRef),
      userAgent,
    };
  }
}
