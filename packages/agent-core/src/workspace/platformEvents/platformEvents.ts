/** Workspace-scoped replayable platform lifecycle events. */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import type {
  PlatformActor,
  PlatformEntityType,
  PlatformLifecycleEvent,
  PlatformMetadata,
  PlatformReplayPage,
} from '@spiderbyte/protocol';

export interface WorkspacePlatformEventInput {
  readonly event_type: string;
  readonly entity_type: PlatformEntityType;
  readonly entity_id: string;
  readonly request_id?: string;
  readonly actor: PlatformActor;
  readonly state?: string;
  readonly payload?: PlatformMetadata;
}

export interface IWorkspacePlatformEventService {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  readonly onDidChange: Event<PlatformLifecycleEvent>;
  append(input: WorkspacePlatformEventInput): Promise<PlatformLifecycleEvent>;
  replay(afterSequence?: number, limit?: number): Promise<PlatformReplayPage>;
}

export const IWorkspacePlatformEventService: ServiceIdentifier<IWorkspacePlatformEventService> =
  createDecorator<IWorkspacePlatformEventService>('platformEvents');
