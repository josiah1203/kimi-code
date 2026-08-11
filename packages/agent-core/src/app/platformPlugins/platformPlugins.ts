/** Provider-neutral Business plugin catalog contract. */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import type {
  PlatformPlugin,
  PlatformPluginCommandInput,
  PlatformPluginConfigureInput,
  PlatformPluginDiscoverInput,
  PlatformPluginInstallInput,
  PlatformPluginManifest,
} from '@spiderbyte/protocol';

export interface PlatformPluginChangedEvent {
  readonly plugin: PlatformPlugin;
  readonly kind: 'installed' | 'configured' | 'activated' | 'paused' | 'revoked' | 'uninstalled';
}

export interface IPlatformPluginService {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  readonly onDidChange: Event<PlatformPluginChangedEvent>;
  discover(input: PlatformPluginDiscoverInput): Promise<PlatformPluginManifest>;
  list(projectId?: string): Promise<readonly PlatformPlugin[]>;
  get(id: string): Promise<PlatformPlugin | undefined>;
  install(input: PlatformPluginInstallInput): Promise<PlatformPlugin>;
  configure(input: PlatformPluginConfigureInput): Promise<PlatformPlugin>;
  command(input: PlatformPluginCommandInput): Promise<PlatformPlugin>;
}

export const IPlatformPluginService: ServiceIdentifier<IPlatformPluginService> =
  createDecorator<IPlatformPluginService>('platformPluginService');
