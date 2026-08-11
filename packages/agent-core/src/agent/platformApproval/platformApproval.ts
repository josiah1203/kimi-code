/**
 * `platformApproval` domain — agent-scoped bridge from durable platform policy
 * decisions to SpiderByte's existing session approval interaction.
 *
 * The bridge keeps approval presentation in the established interaction
 * service while resolving the durable workspace policy decision at the
 * platform boundary. It exposes only Run and policy identifiers to the
 * approval surface; credentials and provider payloads never cross this seam.
 */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { ExecutableToolContext } from '#/tool/toolContract';
import type { ApprovalDecision } from '#/session/approval/approval';

export interface PlatformApprovalRequest {
  readonly runId: string;
  readonly policyDecisionId: string;
  readonly toolName: string;
  readonly action: string;
  readonly context: ExecutableToolContext;
}

export interface PlatformApprovalResult {
  readonly decision: ApprovalDecision;
  readonly policyDecisionId: string;
  readonly feedback?: string;
}

export interface IPlatformApprovalService {
  readonly _serviceBrand: undefined;

  /** Present and persist the decision through SpiderByte's existing approval UX. */
  request(input: PlatformApprovalRequest): Promise<PlatformApprovalResult | undefined>;
}

export const IPlatformApprovalService: ServiceIdentifier<IPlatformApprovalService> =
  createDecorator<IPlatformApprovalService>('platformApprovalService');
