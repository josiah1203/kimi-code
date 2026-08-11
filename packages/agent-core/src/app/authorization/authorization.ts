/** Shared SpiderByte capability authorization contract. */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type {
  PlatformAuthorizationDecision,
  PlatformAuthorizationEvaluateInput,
} from '@spiderbyte/protocol';

export interface IPlatformAuthorizationService {
  readonly _serviceBrand: undefined;
  evaluate(input: PlatformAuthorizationEvaluateInput): Promise<PlatformAuthorizationDecision>;
  assert(input: PlatformAuthorizationEvaluateInput): Promise<PlatformAuthorizationDecision>;
}

export const IPlatformAuthorizationService: ServiceIdentifier<IPlatformAuthorizationService> =
  createDecorator<IPlatformAuthorizationService>('platformAuthorizationService');
