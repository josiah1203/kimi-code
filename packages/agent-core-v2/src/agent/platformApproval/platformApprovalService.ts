/**
 * `platformApproval` domain — implementation of the agent-scoped policy /
 * interaction bridge.
 *
 * Reads decisions from the workspace policy authority, presents unresolved
 * requests through the session approval broker, and writes the user's result
 * back to that same policy authority. Bound at Agent scope.
 */

import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { abortable } from '#/_base/utils/abort';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { ISessionApprovalService } from '#/session/approval/approval';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';

import {
  IPlatformApprovalService,
  type PlatformApprovalRequest,
  type PlatformApprovalResult,
} from './platformApproval';

export class PlatformApprovalService implements IPlatformApprovalService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IWorkspacePolicyService private readonly policy: IWorkspacePolicyService,
    @ISessionApprovalService private readonly approvals: ISessionApprovalService,
    @ISessionContext private readonly session: ISessionContext,
    @IAgentScopeContext private readonly agent: IAgentScopeContext,
  ) {}

  async request(input: PlatformApprovalRequest): Promise<PlatformApprovalResult | undefined> {
    const decision = await this.policy.get(input.policyDecisionId);
    if (decision === undefined) return undefined;

    if (decision.outcome === 'deny' || decision.state === 'denied') {
      return {
        decision: 'rejected',
        policyDecisionId: input.policyDecisionId,
        feedback: decision.reason,
      };
    }
    if (decision.outcome === 'allow' || decision.state === 'approved' || decision.state === 'audited') {
      return { decision: 'approved', policyDecisionId: input.policyDecisionId };
    }

    const response = await abortable(
      this.approvals.request({
        id: `platform:${input.policyDecisionId}:approval`,
        sessionId: this.session.sessionId,
        agentId: this.agent.agentId,
        turnId: input.context.turnId,
        toolCallId: input.context.toolCallId,
        toolName: input.toolName,
        action: input.action,
        display: {
          kind: 'generic',
          summary: `Approve ${input.action}`,
          detail: {
            run_id: input.runId,
            policy_decision_id: input.policyDecisionId,
          },
        },
      }),
      input.context.signal,
    );

    if (response.decision !== 'approved') {
      await this.policy.deny(input.policyDecisionId, {
        request_id: `platform:${input.policyDecisionId}:deny`,
        decided_by: 'user',
        reason: response.feedback ?? 'Platform policy approval was denied by the user.',
      });
      return {
        decision: response.decision,
        policyDecisionId: input.policyDecisionId,
        feedback: response.feedback,
      };
    }

    const approved = await this.policy.approve(input.policyDecisionId, {
      request_id: `platform:${input.policyDecisionId}:approve`,
      decided_by: 'user',
      reason: response.feedback,
    });
    if (approved === undefined) return undefined;
    return { decision: 'approved', policyDecisionId: input.policyDecisionId };
  }
}

registerScopedService(
  LifecycleScope.Agent,
  IPlatformApprovalService,
  PlatformApprovalService,
  ScopeActivation.OnDemand,
  'platformApproval',
);
