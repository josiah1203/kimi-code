/**
 * `platformModelBinding` domain — owns the current agent's optional platform
 * provider/model selection without storing credentials or replacing Kimi's
 * normal model profile. Bound at Agent scope.
 */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Model } from '#/kosong/model/catalog';
import type { ModelRequester } from '#/kosong/model/modelRequester';
import type { ModelRef, PlatformModelSelection as PlatformModelSelectionProjection } from '@moonshot-ai/protocol';

export type { ModelRef } from '@moonshot-ai/protocol';

export interface PlatformModelBinding {
  readonly connection_id: string;
  readonly provider: string;
  readonly model: string;
  readonly model_ref: ModelRef;
  readonly model_alias: string;
  readonly model_definition: Model;
  readonly requester: ModelRequester;
  readonly run_id?: string;
  readonly fallback_connection_ids: readonly string[];
  readonly policy_decision_id?: string;
}

export interface PlatformModelSelection {
  readonly connection_id: string;
  readonly model?: string;
  readonly run_id?: string;
  readonly fallback_connection_ids?: readonly string[];
  readonly policy_decision_id?: string;
}

export interface IPlatformModelBindingService {
  readonly _serviceBrand: undefined;

  current(): PlatformModelBinding | undefined;
  /** Secret-free persisted selection, available while runtime hydration is pending or failed. */
  selection(): PlatformModelSelection | undefined;
  /** A redacted provider/runtime error that prevents the persisted selection from hydrating. */
  selectionError(): Error | undefined;
  select(input: PlatformModelSelection): Promise<PlatformModelBinding>;
  /** Wire-safe projection used by klient and other agent clients. */
  selectionProjection(): PlatformModelSelectionProjection | undefined;
  /** Wire-safe selection getter for positional klient calls. */
  getSelection(): PlatformModelSelectionProjection | undefined;
  /** Select a model and return only the secret-free wire projection. */
  selectProjection(input: PlatformModelSelectionProjection): Promise<PlatformModelSelectionProjection>;
  /** Attach the current conversational root Run without changing persisted selection. */
  attachRun(runId: string | undefined): void;
  clear(): void;
}

export const IPlatformModelBindingService: ServiceIdentifier<IPlatformModelBindingService> =
  createDecorator<IPlatformModelBindingService>('platformModelBindingService');
