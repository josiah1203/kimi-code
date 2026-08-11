/**
 * Durable descriptors for platform work initiated from the agent.
 *
 * A Run is persisted independently from the tool invocation that created it.
 * Keeping a small, secret-free operation descriptor in Run metadata gives a
 * later retry/rerun/fork a typed dispatch key without persisting a prompt,
 * provider payload, or executable code.
 */

import { z } from 'zod';

import type { Run } from '@spiderbyte/protocol';
import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { Error2, ErrorCodes } from '#/errors';

export const platformRunOperationDomainSchema = z.enum([
  'dataset',
  'provider',
  'resource',
  'ml',
  'pipeline',
  'serving',
]);

export type PlatformRunOperationDomain = z.infer<typeof platformRunOperationDomainSchema>;

export const platformRunOperationSchema = z.strictObject({
  version: z.literal(1),
  domain: platformRunOperationDomainSchema,
  operation: z.string().min(1).max(80),
  input: z.record(z.string(), z.unknown()),
});

export type PlatformRunOperation = z.infer<typeof platformRunOperationSchema>;

export interface PlatformRunReplayResult {
  readonly run: Run;
  readonly replayable: boolean;
  readonly result?: unknown;
  readonly approval_required?: boolean;
  readonly policy_decision_id?: string;
  readonly error?: string;
}

export interface IPlatformRunReplayService {
  readonly _serviceBrand: undefined;

  /** Execute the operation descriptor attached to an already-created child Run. */
  replay(runId: string, requestId: string): Promise<PlatformRunReplayResult>;
}

export const IPlatformRunReplayService: ServiceIdentifier<IPlatformRunReplayService> =
  createDecorator<IPlatformRunReplayService>('platformRunReplayService');

/**
 * Return a compact metadata patch suitable for `Run.create`.
 *
 * The caller is responsible for selecting only replay-safe arguments. The
 * Run service still applies its recursive sensitive-metadata guard before
 * persisting the patch.
 */
export function platformRunOperationMetadata(
  domain: PlatformRunOperationDomain,
  input: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const { operation, ...rest } = input;
  const descriptor = platformRunOperationSchema.parse({
    version: 1,
    domain,
    operation: typeof operation === 'string' ? operation : 'unknown',
    input: Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
  });
  if (JSON.stringify(descriptor).length > 128_000) {
    throw new Error2(
      ErrorCodes.REQUEST_INVALID,
      'platform Run operation descriptor exceeds the durable metadata limit',
    );
  }
  return { platform_operation: descriptor };
}

export function platformRunOperation(run: Run): PlatformRunOperation | undefined {
  const value = run.metadata?.['platform_operation'];
  const parsed = platformRunOperationSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
