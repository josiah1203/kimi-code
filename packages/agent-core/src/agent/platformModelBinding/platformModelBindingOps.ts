/**
 * `platformModelBinding` domain — replayable Agent-scoped provider/model
 * selection vocabulary.
 *
 * The wire model stores only the canonical `ModelRef`, fallback connection
 * ids, and an opaque policy decision id. Credential material and runtime
 * requester instances remain outside the journal and are reconstructed from
 * the workspace provider runtime after restore.
 */

import { z } from 'zod';
import { modelRefSchema, providerConnectionIdSchema, policyDecisionIdSchema } from '@spiderbyte/protocol';
import { defineModel } from '#/wire/model';

export interface PlatformModelBindingState {
  readonly modelRef?: z.infer<typeof modelRefSchema>;
  readonly fallbackConnectionIds: readonly z.infer<typeof providerConnectionIdSchema>[];
  readonly policyDecisionId?: z.infer<typeof policyDecisionIdSchema>;
}

export const PlatformModelBindingModel = defineModel<PlatformModelBindingState>(
  'platform.modelBinding',
  () => ({ fallbackConnectionIds: [] }),
);

export const platformModelSelected = PlatformModelBindingModel.defineOp('platform.model.selected', {
  schema: z.strictObject({
    model_ref: modelRefSchema,
    fallback_connection_ids: z.array(providerConnectionIdSchema).readonly().default([]),
    policy_decision_id: policyDecisionIdSchema.optional(),
  }),
  apply: (_state, payload) => ({
    modelRef: payload.model_ref,
    fallbackConnectionIds: payload.fallback_connection_ids,
    policyDecisionId: payload.policy_decision_id,
  }),
});

export const platformModelCleared = PlatformModelBindingModel.defineOp('platform.model.cleared', {
  schema: z.strictObject({}),
  apply: () => ({ fallbackConnectionIds: [] }),
});

declare module '#/wire/types' {
  interface PersistedOpMap {
    'platform.model.selected': typeof platformModelSelected;
    'platform.model.cleared': typeof platformModelCleared;
  }
}
