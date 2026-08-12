import { z } from 'zod';

export const commercialApiErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  detail: z.record(z.string(), z.unknown()).optional(),
});

export const commercialApiEnvelopeSchema = z.union([
  z.strictObject({ request_id: z.string().min(1), data: z.unknown() }),
  z.strictObject({ request_id: z.string().min(1), error: commercialApiErrorSchema }),
]);

export type CommercialApiErrorBody = z.infer<typeof commercialApiErrorSchema>;
export type CommercialApiEnvelope<T> =
  | { readonly request_id: string; readonly data: T }
  | { readonly request_id: string; readonly error: CommercialApiErrorBody };

export interface CommercialMutationHeaders {
  readonly request_id: string;
  readonly idempotency_key?: string;
}
