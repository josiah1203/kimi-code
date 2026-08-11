/**
 * Durable capability-policy evaluator.
 *
 * The evaluator is deliberately small and deterministic: workspace rules are
 * matched by capability and optional action, with exact action matches taking
 * precedence. The resulting decision is persisted before it is emitted, and
 * every mutation is idempotent by request id.
 */

import { ulid } from 'ulid';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Emitter, type Event } from '#/_base/event';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import {
  nowIsoDateTime,
  policyDecisionAuditInputSchema,
  policyDecisionResolveInputSchema,
  policyDecisionSchema,
  policyEvaluateInputSchema,
  policyRuleSchema,
  policyRulesUpdateInputSchema,
  type PolicyDecision,
  type PolicyDecisionAuditInput,
  type PolicyDecisionResolveInput,
  type PolicyEvaluateInput,
  type PolicyRule,
  type PolicyRulesUpdateInput,
} from '@spiderbyte/protocol';

import { IWorkspacePolicyService, type WorkspacePolicyChangedEvent } from './policy';
import { PolicyErrors, PolicyDecisionError } from './errors';
import { findSensitivePlatformMetadataPath } from '#/workspace/platformServices/metadata';

const POLICY_KEY = 'policy.json';
const DOCUMENT_VERSION = 1;

const defaultRules: readonly PolicyRule[] = [
  { capability: 'shell', effect: 'allow', reason: 'local shell actions are governed by SpiderByte tool policy' },
  { capability: 'filesystem', effect: 'allow', reason: 'local filesystem actions are governed by SpiderByte tool policy' },
  { capability: 'model', effect: 'allow', reason: 'model selection is allowed by the workspace default' },
  { capability: 'network', effect: 'approval_required', reason: 'network access can move data outside the workspace' },
  { capability: 'credentials', effect: 'approval_required', reason: 'credential access requires an explicit capability grant' },
  { capability: 'dataset', effect: 'approval_required', reason: 'dataset access requires an explicit capability grant' },
  { capability: 'connector', effect: 'approval_required', reason: 'connector access requires an explicit capability grant' },
  { capability: 'cloud', effect: 'approval_required', reason: 'cloud execution requires an explicit capability grant' },
  { capability: 'serving', effect: 'approval_required', reason: 'serving requires an explicit capability grant' },
  { capability: 'deploy', effect: 'approval_required', reason: 'deployment requires an explicit capability grant' },
];

const policyDocumentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  rules: z.array(policyRuleSchema),
  decisions: z.array(policyDecisionSchema),
  requests: z.record(z.string(), z.string()).default({}),
  rule_requests: z.array(z.string()).default([]),
});

type PolicyDocument = z.infer<typeof policyDocumentSchema>;

export class WorkspacePolicyService extends Disposable implements IWorkspacePolicyService {
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspacePolicyChangedEvent>;

  private readonly changes = this._register(new Emitter<WorkspacePolicyChangedEvent>());
  private readonly scope: string;
  private rulesValue: readonly PolicyRule[] = defaultRules;
  private decisions: readonly PolicyDecision[] = [];
  private requests: Record<string, string> = {};
  private ruleRequests: readonly string[] = [];
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IWorkspaceContext private readonly context: IWorkspaceContext,
    @IWorkspacePlatformEventService private readonly events: IWorkspacePlatformEventService,
  ) {
    super();
    this.scope = `${context.persistenceScope}/platform`;
    this.onDidChange = this.changes.event;
    this.ready = this.load();
  }

  async list(): Promise<readonly PolicyDecision[]> {
    await this.ready;
    return [...this.decisions];
  }

  async get(id: string): Promise<PolicyDecision | undefined> {
    await this.ready;
    return this.decisions.find((decision) => decision.id === id);
  }

  async assertUsable(
    id: string,
    input: { readonly capability: PolicyDecision['capability']; readonly action: string; readonly run_id?: string },
  ): Promise<PolicyDecision> {
    await this.ready;
    const decision = this.require(id);
    if (
      decision.capability !== input.capability ||
      decision.action !== input.action ||
      (decision.run_id !== undefined && decision.run_id !== input.run_id)
    ) {
      throw new PolicyDecisionError(
        PolicyErrors.codes.POLICY_DECISION_INVALID_STATE,
        `policy decision ${id} does not cover ${input.capability}:${input.action}`,
        {
          id,
          policy_decision_id: id,
          expected_capability: input.capability,
          expected_action: input.action,
          decision_capability: decision.capability,
          decision_action: decision.action,
          expected_run_id: input.run_id,
          decision_run_id: decision.run_id,
        },
      );
    }
    if (
      decision.outcome === 'deny' ||
      decision.state === 'denied' ||
      (decision.outcome === 'approval_required' && decision.state !== 'approved' && decision.state !== 'audited')
    ) {
      throw new PolicyDecisionError(
        PolicyErrors.codes.POLICY_DECISION_INVALID_STATE,
        `policy decision ${id} is not approved for execution`,
        { id, policy_decision_id: id, state: decision.state, outcome: decision.outcome },
      );
    }
    return decision;
  }

  async rules(): Promise<readonly PolicyRule[]> {
    await this.ready;
    return [...this.rulesValue];
  }

  async setRules(input: PolicyRulesUpdateInput): Promise<readonly PolicyRule[]> {
    const command = policyRulesUpdateInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      if (this.ruleRequests.includes(command.request_id)) return [...this.rulesValue];
      const rules = command.rules.map((rule) => policyRuleSchema.parse(rule));
      await this.replace(this.decisions, rules, this.requests, [
        ...this.ruleRequests,
        command.request_id,
      ]);
      await this.events.append({
        event_type: 'policy_decision.updated',
        entity_type: 'policy_decision',
        entity_id: 'policy_rules',
        request_id: command.request_id,
        actor: 'user',
        payload: { rule_count: rules.length },
      });
      this.changes.fire({ rules, kind: 'rules_updated' });
      return [...rules];
    });
  }

  async evaluate(input: PolicyEvaluateInput): Promise<PolicyDecision> {
    const command = policyEvaluateInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.require(existingId);

      const rule = selectRule(this.rulesValue, command.capability, command.action);
      const now = nowIsoDateTime();
      const decision = policyDecisionSchema.parse({
        id: `policy_${ulid()}`,
        workspace_id: this.context.workspaceId,
        run_id: command.run_id,
        capability: command.capability,
        action: command.action,
        state: 'evaluated',
        outcome: rule.effect,
        reason: rule.reason,
        requested_by: command.requested_by,
        requested_at: now,
        evaluated_at: now,
        metadata: command.metadata,
      });
      await this.replace(
        [...this.decisions, decision],
        this.rulesValue,
        { ...this.requests, [command.request_id]: decision.id },
        this.ruleRequests,
      );
      await this.events.append({
        event_type: 'policy_decision.evaluated',
        entity_type: 'policy_decision',
        entity_id: decision.id,
        request_id: command.request_id,
        actor: command.requested_by,
        state: decision.state,
        payload: { capability: decision.capability, action: decision.action },
      });
      this.changes.fire({ decision, rules: this.rulesValue, kind: 'evaluated' });
      return decision;
    });
  }

  async approve(
    id: string,
    input: PolicyDecisionResolveInput,
  ): Promise<PolicyDecision | undefined> {
    return this.resolve(id, policyDecisionResolveInputSchema.parse(input), 'approved');
  }

  async deny(
    id: string,
    input: PolicyDecisionResolveInput,
  ): Promise<PolicyDecision | undefined> {
    return this.resolve(id, policyDecisionResolveInputSchema.parse(input), 'denied');
  }

  async audit(
    id: string,
    input: PolicyDecisionAuditInput,
  ): Promise<PolicyDecision | undefined> {
    const command = policyDecisionAuditInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const current = this.require(id);
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.require(existingId);
      if (current.state !== 'approved' && current.state !== 'denied' && current.state !== 'audited') {
        throw new PolicyDecisionError(
          PolicyErrors.codes.POLICY_DECISION_INVALID_STATE,
          `policy decision must be resolved before audit: ${id}`,
          { id, state: current.state },
        );
      }
      if (current.state === 'audited') return current;
      const next = policyDecisionSchema.parse({
        ...current,
        state: 'audited',
        audit_ref: command.audit_ref ?? `audit_${ulid()}`,
        resolved_at: current.resolved_at ?? nowIsoDateTime(),
      });
      await this.replace(
        this.decisions.map((decision) => (decision.id === id ? next : decision)),
        this.rulesValue,
        { ...this.requests, [command.request_id]: id },
        this.ruleRequests,
      );
      await this.events.append({
        event_type: 'policy_decision.audited',
        entity_type: 'policy_decision',
        entity_id: id,
        request_id: command.request_id,
        actor: 'policy',
        state: next.state,
        payload: { audit_ref: next.audit_ref },
      });
      this.changes.fire({ decision: next, rules: this.rulesValue, kind: 'audited' });
      return next;
    });
  }

  async explain(id: string): Promise<PolicyDecision | undefined> {
    return this.get(id);
  }

  private async resolve(
    id: string,
    command: PolicyDecisionResolveInput,
    state: 'approved' | 'denied',
  ): Promise<PolicyDecision | undefined> {
    return this.enqueue(async () => {
      await this.ready;
      const current = this.require(id);
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.require(existingId);
      if (current.state === 'audited') return current;
      if (current.state !== 'evaluated' && current.state !== 'approved' && current.state !== 'denied') {
        throw new PolicyDecisionError(
          PolicyErrors.codes.POLICY_DECISION_INVALID_STATE,
          `policy decision is not resolvable: ${id}`,
          { id, state: current.state },
        );
      }
      const now = nowIsoDateTime();
      const next = policyDecisionSchema.parse({
        ...current,
        state,
        outcome: state === 'approved' ? 'allow' : 'deny',
        reason: command.reason ?? current.reason,
        decided_by: command.decided_by,
        resolved_at: now,
      });
      await this.replace(
        this.decisions.map((decision) => (decision.id === id ? next : decision)),
        this.rulesValue,
        { ...this.requests, [command.request_id]: id },
        this.ruleRequests,
      );
      await this.events.append({
        event_type: `policy_decision.${state}`,
        entity_type: 'policy_decision',
        entity_id: id,
        request_id: command.request_id,
        actor: command.decided_by,
        state: next.state,
      });
      this.changes.fire({ decision: next, rules: this.rulesValue, kind: state });
      return next;
    });
  }

  private require(id: string): PolicyDecision {
    const decision = this.decisions.find((candidate) => candidate.id === id);
    if (decision === undefined) {
      throw new PolicyDecisionError(
        PolicyErrors.codes.POLICY_DECISION_NOT_FOUND,
        `policy decision not found: ${id}`,
        { id },
      );
    }
    return decision;
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, POLICY_KEY);
    if (raw === undefined) {
      await this.replace([], defaultRules, {}, []);
      return;
    }
    const document = policyDocumentSchema.parse(raw);
    this.rulesValue = document.rules;
    this.decisions = document.decisions;
    this.requests = document.requests;
    this.ruleRequests = document.rule_requests;
  }

  private async replace(
    decisions: readonly PolicyDecision[],
    rules: readonly PolicyRule[],
    requests: Record<string, string>,
    ruleRequests: readonly string[],
  ): Promise<void> {
    const document: PolicyDocument = {
      version: DOCUMENT_VERSION,
      rules: [...rules],
      decisions: [...decisions],
      requests,
      rule_requests: [...ruleRequests],
    };
    await this.store.set(this.scope, POLICY_KEY, document);
    this.rulesValue = document.rules;
    this.decisions = document.decisions;
    this.requests = document.requests;
    this.ruleRequests = document.rule_requests;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(work, work);
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function selectRule(
  rules: readonly PolicyRule[],
  capability: PolicyRule['capability'],
  action: string,
): PolicyRule {
  const matching = rules.filter(
    (rule) =>
      rule.capability === capability &&
      (rule.action === undefined || rule.action === '*' || rule.action === action),
  );
  return (
    matching.find((rule) => rule.action === action) ??
    matching.find((rule) => rule.action === undefined || rule.action === '*') ?? {
      capability,
      effect: 'approval_required',
      reason: `no workspace rule allows '${capability}:${action}'`,
    }
  );
}

function assertSafeMetadata(metadata: Readonly<Record<string, unknown>> | undefined): void {
  const path = findSensitivePlatformMetadataPath(metadata);
  if (path !== undefined) {
    throw new PolicyDecisionError(
      PolicyErrors.codes.POLICY_DECISION_SECRET_MATERIAL,
      `policy metadata cannot contain secret material in '${path}'`,
      { key: path },
    );
  }
}

registerScopedService(
  LifecycleScope.Workspace,
  IWorkspacePolicyService,
  WorkspacePolicyService,
  ScopeActivation.OnScopeCreated,
  'policy',
);
