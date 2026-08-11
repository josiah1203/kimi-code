/**
 * `platformConversation` domain — the agent-local projection of the durable
 * session Runs that were created by a platform-aware conversation.
 *
 * The Run service remains authoritative. This service only keeps the current
 * conversational pointer and resolves natural-language references such as
 * "last Run" to a persisted Run id, so follow-up tool calls do not need to
 * make the model repeat an opaque identifier.
 */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import type { Run } from '@spiderbyte/protocol';

export interface PlatformConversationRunChangedEvent {
  readonly run: Run;
  readonly previous?: Run;
}

export interface IPlatformConversationService {
  readonly _serviceBrand: undefined;

  /** Resolves after the durable session Run index has been loaded. */
  readonly ready: Promise<void>;

  /** The latest meaningful platform Run in the current conversation. */
  current(): Promise<Run | undefined>;

  /** The durable root Run for the current conversational prompt. */
  root(): Promise<Run | undefined>;

  /**
   * Resolve an exact Run id or a conversational alias (`last`, `latest`,
   * `current`, `previous`, and their `*_run` forms).
   */
  resolveRunReference(reference?: string): Promise<Run | undefined>;

  /** Resolve a dataset id from an exact id or the latest matching Run. */
  resolveDatasetReference(reference?: string): Promise<string | undefined>;

  readonly onDidChange: Event<PlatformConversationRunChangedEvent>;
}

export const IPlatformConversationService: ServiceIdentifier<IPlatformConversationService> =
  createDecorator<IPlatformConversationService>('platformConversationService');

export function isConversationalPlatformRun(run: Run): boolean {
  // Ordinary prompt Runs intentionally have no metadata. Platform tools and
  // provider model requests carry a secret-free metadata descriptor, which is
  // the durable boundary between those two projections.
  return run.metadata !== undefined && Object.keys(run.metadata).length > 0;
}

export function conversationalRunAlias(reference: string): boolean {
  const normalized = reference
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, '_')
    .replace(/^the_+/, '');
  return normalized === 'last'
    || normalized === 'latest'
    || normalized === 'current'
    || normalized === 'previous'
    || normalized === 'prior'
    || normalized === 'last_run'
    || normalized === 'latest_run'
    || normalized === 'current_run'
    || normalized === 'previous_run'
    || normalized === 'prior_run'
    || normalized === 'most_recent'
    || normalized === 'most_recent_run';
}
