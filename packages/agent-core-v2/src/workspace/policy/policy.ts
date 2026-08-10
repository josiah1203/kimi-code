/**
 * Workspace-scoped policy decisions and capability grants.
 *
 * Policy is the durable decision authority above individual approval prompts.
 * A decision can be explained to a client, resolved by an actor, and audited
 * without exposing credentials or implementation-specific tool internals.
 */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import type {
  PolicyDecision,
  PolicyDecisionAuditInput,
  PolicyDecisionResolveInput,
  PolicyEvaluateInput,
  PolicyRule,
  PolicyRulesUpdateInput,
} from '@moonshot-ai/protocol';

export interface WorkspacePolicyChangedEvent {
  readonly decision?: PolicyDecision;
  readonly rules: readonly PolicyRule[];
  readonly kind: 'evaluated' | 'approved' | 'denied' | 'audited' | 'rules_updated';
}

export interface IWorkspacePolicyService {
  readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspacePolicyChangedEvent>;
  list(): Promise<readonly PolicyDecision[]>;
  get(id: string): Promise<PolicyDecision | undefined>;
  /**
   * Resolve a decision for a concrete capability/action boundary. A decision
   * is never reusable across capabilities, actions, or explicitly scoped
   * Runs, even when its outcome is allow.
   */
  assertUsable(
    id: string,
    input: { readonly capability: PolicyDecision['capability']; readonly action: string; readonly run_id?: string },
  ): Promise<PolicyDecision>;
  rules(): Promise<readonly PolicyRule[]>;
  setRules(input: PolicyRulesUpdateInput): Promise<readonly PolicyRule[]>;
  evaluate(input: PolicyEvaluateInput): Promise<PolicyDecision>;
  approve(id: string, input: PolicyDecisionResolveInput): Promise<PolicyDecision | undefined>;
  deny(id: string, input: PolicyDecisionResolveInput): Promise<PolicyDecision | undefined>;
  audit(id: string, input: PolicyDecisionAuditInput): Promise<PolicyDecision | undefined>;
  explain(id: string): Promise<PolicyDecision | undefined>;
}

export const IWorkspacePolicyService: ServiceIdentifier<IWorkspacePolicyService> =
  createDecorator<IWorkspacePolicyService>('policyService');
