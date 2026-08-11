/** Durable automation definitions with approval-gated, retry-aware fire records. */

import { ulid } from 'ulid';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { IInstantiationService, type ServiceIdentifier } from '#/_base/di/instantiation';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Emitter, type Event } from '#/_base/event';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IAgentPromptService } from '#/agent/prompt/prompt';
import { ensureMainAgent } from '#/session/agentLifecycle/mainAgent';
import { ISessionRunService } from '#/session/run/run';
import { ISessionLifecycleService } from '#/workspace/sessionLifecycle/sessionLifecycle';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import { IWorkspacePipelineService } from '#/workspace/pipelines/pipeline';
import { IWorkspaceArtifactService } from '#/workspace/artifacts/artifact';
import { computeNextCronRun, parseCronExpression } from '#/app/cron/cron-expr';
import {
  automationCreateInputSchema,
  automationFireInputSchema,
  automationFireResultSchema,
  automationSchema,
  automationUpdateInputSchema,
  nowIsoDateTime,
  type Automation,
  type AutomationCreateInput,
  type AutomationFireInput,
  type AutomationFireResult,
  type AutomationUpdateInput,
} from '@spiderbyte/protocol';

import { IWorkspaceAutomationService, type WorkspaceAutomationsChangedEvent } from './automation';
import { AutomationErrors, AutomationServiceError } from './errors';
import { findSensitivePlatformMetadataPath } from '#/workspace/platformServices/metadata';

const AUTOMATION_KEY = 'automations.json';
const DOCUMENT_VERSION = 1;

const fireRecordSchema = automationFireResultSchema;
const documentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  automations: z.array(automationSchema),
  fires: z.array(fireRecordSchema),
  requests: z.record(z.string(), z.string()).default({}),
});

type AutomationDocument = z.infer<typeof documentSchema>;

export class WorkspaceAutomationService extends Disposable implements IWorkspaceAutomationService {
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceAutomationsChangedEvent>;

  private readonly changes = this._register(new Emitter<WorkspaceAutomationsChangedEvent>());
  private readonly scope: string;
  private automations: readonly Automation[] = [];
  private fires: readonly AutomationFireResult[] = [];
  private requests: Record<string, string> = {};
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IWorkspaceContext private readonly context: IWorkspaceContext,
    @IWorkspacePolicyService private readonly policy: IWorkspacePolicyService,
    @ISessionLifecycleService private readonly sessions: ISessionLifecycleService,
    @IWorkspacePlatformEventService private readonly events: IWorkspacePlatformEventService,
    @IInstantiationService private readonly instantiation: IInstantiationService,
    @IWorkspacePipelineService private readonly pipelines?: IWorkspacePipelineService,
    @IWorkspaceArtifactService private readonly artifacts?: IWorkspaceArtifactService,
  ) {
    super();
    this.scope = `${context.persistenceScope}/platform`;
    this.onDidChange = this.changes.event;
    this.ready = this.load();
  }

  async list(): Promise<readonly Automation[]> {
    await this.ready;
    return [...this.automations];
  }

  async get(id: string): Promise<Automation | undefined> {
    await this.ready;
    return this.automations.find((automation) => automation.id === id);
  }

  async history(automationId?: string): Promise<readonly AutomationFireResult[]> {
    await this.ready;
    return this.fires.filter((fire) => automationId === undefined || fire.automation_id === automationId);
  }

  async create(input: AutomationCreateInput): Promise<Automation> {
    const command = automationCreateInputSchema.parse(input);
    validateTrigger(command);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.require(mapped);
      if (this.automations.some((automation) => automation.name === command.name)) {
        throw new AutomationServiceError(
          AutomationErrors.codes.AUTOMATION_NAME_TAKEN,
          `automation name already exists: ${command.name}`,
          { name: command.name },
        );
      }
      await this.assertPipeline(command.pipeline_id);
      const now = nowIsoDateTime();
      const { request_id: _requestId, ...inputWithoutRequest } = command;
      const automation = automationSchema.parse({
        ...inputWithoutRequest,
        id: `automation_${ulid()}`,
        workspace_id: this.context.workspaceId,
        state: 'enabled',
        retry_policy: command.retry_policy,
        ...(command.trigger === 'cron' && command.schedule !== undefined
          ? { next_run_at: nextCronRun(command.schedule, Date.now()) }
          : {}),
        created_at: now,
        updated_at: now,
      });
      await this.replace([...this.automations, automation], this.fires, {
        ...this.requests,
        [command.request_id]: automation.id,
      });
      await this.events.append({
        event_type: 'automation.created',
        entity_type: 'automation',
        entity_id: automation.id,
        request_id: command.request_id,
        actor: 'user',
        payload: { automation: true, trigger: automation.trigger },
      });
      this.changes.fire({ automation, kind: 'created' });
      return automation;
    });
  }

  async update(id: string, input: AutomationUpdateInput): Promise<Automation | undefined> {
    const command = automationUpdateInputSchema.parse(input);
    if (command.schedule !== undefined) validateCron(command.schedule);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const current = this.require(id);
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.require(mapped);
      const { request_id: _requestId, ...patch } = command;
      await this.assertPipeline(command.pipeline_id);
      const automation = automationSchema.parse({
        ...current,
        ...patch,
        ...(command.schedule !== undefined
          ? { next_run_at: nextCronRun(command.schedule, Date.now()) }
          : {}),
        updated_at: nowIsoDateTime(),
      });
      await this.replace(
        this.automations.map((candidate) => (candidate.id === id ? automation : candidate)),
        this.fires,
        { ...this.requests, [command.request_id]: id },
      );
      await this.events.append({
        event_type: 'automation.updated',
        entity_type: 'automation',
        entity_id: id,
        request_id: command.request_id,
        actor: 'user',
        state: automation.state,
        payload: { automation: true },
      });
      this.changes.fire({ automation, kind: 'updated' });
      return automation;
    });
  }

  async fire(id: string, input: AutomationFireInput): Promise<AutomationFireResult> {
    const command = automationFireInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const automation = this.require(id);
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requireFire(mapped);
      const priorAttempts = attemptFor(this.fires, command.retry_of_request_id);
      const firedAt = nowIsoDateTime();
      if (automation.state !== 'enabled') {
        const rejected = automationFireResultSchema.parse({
          request_id: command.request_id,
          automation_id: id,
          status: 'rejected',
          attempt: priorAttempts + 1,
          fired_at: firedAt,
          error: `automation is ${automation.state}`,
        });
        await this.saveFire(rejected, automation, command.request_id);
        return rejected;
      }

      const policy = command.policy_decision_id === undefined
        ? await this.policy.evaluate({
          request_id: `automation_policy_${command.request_id}`,
          capability: 'cloud',
          action: `automation:${automation.name}`,
          requested_by: command.actor,
          metadata: { automation_id: id, trigger: automation.trigger },
        })
        : await this.policy.assertUsable(command.policy_decision_id, {
          capability: 'cloud',
          action: `automation:${automation.name}`,
        });
      if (policy === undefined) {
        throw new AutomationServiceError(
          AutomationErrors.codes.AUTOMATION_POLICY_REQUIRED,
          'automation approval decision is unavailable',
          { policy_decision_id: command.policy_decision_id },
        );
      }
      if (policy.capability !== 'cloud' || policy.outcome === 'deny' || policy.state === 'denied') {
        const rejected = automationFireResultSchema.parse({
          request_id: command.request_id,
          automation_id: id,
          status: 'rejected',
          policy_decision_id: policy.id,
          attempt: priorAttempts + 1,
          fired_at: firedAt,
          error: policy.reason,
        });
        await this.saveFire(rejected, automation, command.request_id);
        return rejected;
      }
      const policyApproved =
        policy.outcome === 'allow' || policy.state === 'approved' || policy.state === 'audited';
      let status: AutomationFireResult['status'] =
        policy.outcome === 'approval_required' && !policyApproved
            ? 'awaiting_approval'
            : automation.approval_required && command.policy_decision_id === undefined
            ? 'awaiting_approval'
            : 'queued';
      let launch: {
        runId: string;
        sessionId: string;
        pipelineRunId?: string;
        status?: Extract<AutomationFireResult['status'], 'queued' | 'awaiting_approval' | 'succeeded' | 'failed' | 'cancelled'>;
        error?: string;
      } | undefined;
      let launchError: string | undefined;
      if (status === 'queued') {
        try {
          launch = await this.launchPrompt(automation, command.request_id);
          status = launch.status ?? status;
        } catch (error) {
          status = 'failed';
          launchError = error instanceof Error ? error.message : 'automation launch failed';
        }
      }
      const result = automationFireResultSchema.parse({
        request_id: command.request_id,
        automation_id: id,
        status,
        ...(launch === undefined ? {} : { run_id: launch.runId }),
        ...(launch?.pipelineRunId === undefined ? {} : { pipeline_run_id: launch.pipelineRunId }),
        policy_decision_id: policy.id,
        retry_of_request_id: command.retry_of_request_id,
        attempt: priorAttempts + 1,
        fired_at: firedAt,
        error: launchError ?? launch?.error,
        ...(status === 'failed' && priorAttempts + 1 < automation.retry_policy.max_attempts
          ? { retry_at: new Date(Date.parse(firedAt) + automation.retry_policy.backoff_seconds * 1_000).toISOString() }
          : {}),
      });
      const nextAutomation = automationSchema.parse({
        ...automation,
        updated_at: firedAt,
        ...(launch === undefined ? {} : { last_run_id: launch.runId, agent_session_id: launch.sessionId }),
        ...(automation.trigger === 'cron' && automation.schedule !== undefined
          ? { next_run_at: nextCronRun(automation.schedule, Date.parse(firedAt)) }
          : {}),
      });
      await this.saveFire(result, nextAutomation, command.request_id);
      await this.events.append({
        event_type: 'automation.fired',
        entity_type: 'automation',
        entity_id: id,
        request_id: command.request_id,
        actor: command.actor,
        state: status,
        payload: {
          automation_id: id,
          retry_attempt: result.attempt,
          policy_decision_id: policy.id,
          ...(result.run_id === undefined ? {} : { run_id: result.run_id }),
          ...(result.pipeline_run_id === undefined ? {} : { pipeline_run_id: result.pipeline_run_id }),
          ...(automation.pipeline_id === undefined ? {} : { pipeline_id: automation.pipeline_id }),
        },
      });
      this.changes.fire({ automation: nextAutomation, kind: 'fired', fire: result });
      return result;
    });
  }

  async fireDue(now = new Date()): Promise<readonly AutomationFireResult[]> {
    await this.ready;
    const retryDue = this.fires.filter((fire) => {
      if (fire.status !== 'failed' || fire.retry_at === undefined || Date.parse(fire.retry_at) > now.getTime()) return false;
      return !this.fires.some((candidate) => candidate.retry_of_request_id === fire.request_id);
    });
    const retries = await Promise.all(
      retryDue.map((fire) => this.fire(fire.automation_id, {
        request_id: `automation_retry_${fire.request_id}`,
        actor: 'automation',
        retry_of_request_id: fire.request_id,
      })),
    );
    const due = this.automations.filter(
      (automation) => {
        const requestId = `automation_due_${automation.id}_${Math.floor(now.getTime() / 60_000)}`;
        return (
        automation.state === 'enabled' &&
        automation.trigger === 'cron' &&
        automation.next_run_at !== undefined &&
        Date.parse(automation.next_run_at) <= now.getTime() &&
        !this.fires.some((fire) => fire.request_id === requestId)
        );
      },
    );
    const scheduled = await Promise.all(
      due.map((automation) =>
        this.fire(automation.id, {
          request_id: `automation_due_${automation.id}_${Math.floor(now.getTime() / 60_000)}`,
          actor: 'automation',
        }),
      ),
    );
    return [...retries, ...scheduled];
  }

  private async launchPrompt(
    automation: Automation,
    requestId: string,
  ): Promise<{
    runId: string;
    sessionId: string;
    pipelineRunId?: string;
    status?: Extract<AutomationFireResult['status'], 'queued' | 'awaiting_approval' | 'succeeded' | 'failed' | 'cancelled'>;
    error?: string;
  }> {
    let session;
    if (automation.agent_session_id !== undefined) {
      session =
        this.sessions.get(automation.agent_session_id) ??
        (await this.sessions.resume(automation.agent_session_id));
      if (session === undefined) {
        throw new AutomationServiceError(
          AutomationErrors.codes.AUTOMATION_SESSION_NOT_FOUND,
          `automation session not found: ${automation.agent_session_id}`,
          { session_id: automation.agent_session_id },
        );
      }
    } else {
      session = await this.sessions.create({ workDir: this.context.cwd });
    }
    const agent = await ensureMainAgent(session);
    if (automation.pipeline_id !== undefined) {
      const pipelines = this.pipelineService();
      if (pipelines === undefined) {
        throw new AutomationServiceError(
          AutomationErrors.codes.AUTOMATION_PIPELINE_UNAVAILABLE,
          'native pipeline execution is unavailable in this host',
        );
      }
      const runs = agent.accessor.get(ISessionRunService);
      const run = await runs.create({
        request_id: `${requestId}:run`,
        execution_target_id: automation.execution_target_id,
        metadata: {
          kind: 'pipeline_automation',
          pipeline_id: automation.pipeline_id,
          ...(automation.execution_target_id === undefined
            ? {}
            : { execution_target_id: automation.execution_target_id }),
        },
      });
      await runs.transition(run.id, {
        request_id: `${requestId}:planning`,
        status: 'planning',
        execution_target_id: automation.execution_target_id,
      });
      let pipelineRun: Awaited<ReturnType<IWorkspacePipelineService['run']>>;
      try {
        pipelineRun = await pipelines.run(automation.pipeline_id, {
          request_id: `${requestId}:pipeline`,
          run_id: run.id,
          execution_target_id: automation.execution_target_id,
          metadata: {
            source: 'automation',
            automation_id: automation.id,
          },
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'pipeline execution failed';
        await runs.transition(run.id, {
          request_id: `${requestId}:failed`,
          status: 'failed',
          status_reason: reason,
        });
        return {
          runId: run.id,
          sessionId: session.id,
          status: 'failed',
          error: reason,
        };
      }
      if (pipelineRun === undefined) {
        await runs.transition(run.id, {
          request_id: `${requestId}:missing`,
          status: 'failed',
          status_reason: 'pipeline_not_found',
        });
        return {
          runId: run.id,
          sessionId: session.id,
          status: 'failed',
          error: `pipeline not found: ${automation.pipeline_id}`,
        };
      }
      const artifacts = this.artifactService();
      const outputArtifacts = artifacts === undefined
        ? []
        : (await Promise.all(pipelineRun.output_artifact_ids.map((id) => artifacts.get(id))))
          .filter((artifact): artifact is NonNullable<typeof artifact> => artifact !== undefined)
          .map((artifact) => ({ id: artifact.id, version: artifact.version }));
      if (pipelineRun.status === 'awaiting_approval') {
        await runs.transition(run.id, {
          request_id: `${requestId}:awaiting_approval`,
          status: 'awaiting_approval',
          status_reason: pipelineRun.error ?? 'pipeline approval is required',
          output_artifacts: outputArtifacts,
        });
        return {
          runId: run.id,
          sessionId: session.id,
          pipelineRunId: pipelineRun.id,
          status: 'awaiting_approval',
          error: pipelineRun.error,
        };
      }
      await runs.transition(run.id, {
        request_id: `${requestId}:running`,
        status: 'running',
      });
      const finalStatus = pipelineRun.status === 'succeeded'
        ? 'succeeded'
        : pipelineRun.status === 'cancelled'
          ? 'cancelled'
          : pipelineRun.status === 'failed'
            ? 'failed'
            : undefined;
      if (finalStatus !== undefined) {
        await runs.transition(run.id, {
          request_id: `${requestId}:${finalStatus}`,
          status: finalStatus,
          status_reason: pipelineRun.error,
          output_artifacts: outputArtifacts,
        });
      }
      const pipelineStatus = pipelineRun.status === 'succeeded'
        ? 'succeeded'
        : pipelineRun.status === 'failed'
          ? 'failed'
          : pipelineRun.status === 'cancelled'
            ? 'cancelled'
            : undefined;
      return {
        runId: run.id,
        sessionId: session.id,
        pipelineRunId: pipelineRun.id,
        status: pipelineStatus,
        error: pipelineRun.error,
      };
    }
    const prompt = await agent.accessor.get(IAgentPromptService).enqueue({
      requestId,
      message: {
        role: 'user',
        content: [{ type: 'text', text: automation.prompt }],
        toolCalls: [],
        origin: { kind: 'user' },
      },
    });
    if (prompt.runId === undefined) {
      throw new AutomationServiceError(
        AutomationErrors.codes.AUTOMATION_RUN_NOT_CREATED,
        'automation prompt did not create a durable run',
      );
    }
    return { runId: prompt.runId, sessionId: session.id };
  }

  private async assertPipeline(pipelineId: string | undefined): Promise<void> {
    if (pipelineId === undefined) return;
    const pipelines = this.pipelineService();
    if (pipelines === undefined) return;
    if (await pipelines.get(pipelineId) === undefined) {
      throw new AutomationServiceError(
        AutomationErrors.codes.AUTOMATION_PIPELINE_NOT_FOUND,
        `pipeline not found: ${pipelineId}`,
        { pipeline_id: pipelineId },
      );
    }
  }

  /**
   * Pipeline and artifact services are OnDemand workspace units. Resolve
   * them at fire time so hosts that import the automation domain in isolation
   * remain compatible, while a complete platform host still launches native
   * pipeline Runs instead of permanently capturing an undefined optional
   * dependency during scope construction.
   */
  private pipelineService(): IWorkspacePipelineService | undefined {
    return this.pipelines ?? this.resolveOptional(IWorkspacePipelineService);
  }

  private artifactService(): IWorkspaceArtifactService | undefined {
    return this.artifacts ?? this.resolveOptional(IWorkspaceArtifactService);
  }

  private resolveOptional<T>(id: ServiceIdentifier<T>): T | undefined {
    return this.instantiation.invokeFunction((accessor) => {
      if (accessor.has?.(id) === false) return undefined;
      return accessor.get(id);
    });
  }

  private async saveFire(
    fire: AutomationFireResult,
    automation: Automation,
    requestId: string,
  ): Promise<void> {
    await this.replace(
      this.automations.map((candidate) => (candidate.id === automation.id ? automation : candidate)),
      [...this.fires, fire],
      { ...this.requests, [requestId]: fire.request_id },
    );
  }

  private require(id: string): Automation {
    const automation = this.automations.find((candidate) => candidate.id === id);
    if (automation === undefined) {
      throw new AutomationServiceError(AutomationErrors.codes.AUTOMATION_NOT_FOUND, `automation not found: ${id}`, { id });
    }
    return automation;
  }

  private requireFire(requestId: string): AutomationFireResult {
    const fire = this.fires.find((candidate) => candidate.request_id === requestId);
    if (fire === undefined) {
      throw new AutomationServiceError(
        AutomationErrors.codes.AUTOMATION_FIRE_NOT_FOUND,
        `automation fire not found: ${requestId}`,
        { request_id: requestId },
      );
    }
    return fire;
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, AUTOMATION_KEY);
    if (raw === undefined) {
      await this.replace([], [], {});
      return;
    }
    const document = documentSchema.parse(raw);
    this.automations = document.automations;
    this.fires = document.fires;
    this.requests = document.requests;
  }

  private async replace(
    automations: readonly Automation[],
    fires: readonly AutomationFireResult[],
    requests: Record<string, string>,
  ): Promise<void> {
    const document: AutomationDocument = {
      version: DOCUMENT_VERSION,
      automations: [...automations],
      fires: [...fires],
      requests,
    };
    await this.store.set(this.scope, AUTOMATION_KEY, document);
    this.automations = document.automations;
    this.fires = document.fires;
    this.requests = document.requests;
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

function validateTrigger(input: Pick<AutomationCreateInput, 'trigger' | 'schedule'>): void {
  if (input.trigger === 'cron' && input.schedule === undefined) {
    throw new AutomationServiceError(
      AutomationErrors.codes.AUTOMATION_INVALID_SCHEDULE,
      'cron automations require a schedule',
    );
  }
  if (input.schedule !== undefined) validateCron(input.schedule);
}

function validateCron(schedule: string): void {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new AutomationServiceError(
      AutomationErrors.codes.AUTOMATION_INVALID_SCHEDULE,
      'automation schedule must use five cron fields',
    );
  }
  try {
    parseCronExpression(schedule);
  } catch (error) {
    throw new AutomationServiceError(
      AutomationErrors.codes.AUTOMATION_INVALID_SCHEDULE,
      error instanceof Error ? error.message : 'invalid automation schedule',
    );
  }
}

function assertSafeMetadata(metadata: Readonly<Record<string, unknown>> | undefined): void {
  const path = findSensitivePlatformMetadataPath(metadata);
  if (path !== undefined) {
    throw new AutomationServiceError(
      AutomationErrors.codes.AUTOMATION_SECRET_MATERIAL,
      `automation metadata cannot contain secret material in '${path}'`,
      { key: path },
    );
  }
}

function nextCronRun(schedule: string, fromMs: number): string | undefined {
  const next = computeNextCronRun(parseCronExpression(schedule), fromMs);
  return next === null ? undefined : new Date(next).toISOString();
}

function attemptFor(fires: readonly AutomationFireResult[], retryOf: string | undefined): number {
  if (retryOf === undefined) return 0;
  const byRequest = new Map(fires.map((fire) => [fire.request_id, fire]));
  const seen = new Set<string>();
  let current = retryOf;
  let attempt = 0;
  while (!seen.has(current)) {
    seen.add(current);
    const fire = byRequest.get(current);
    if (fire === undefined) break;
    attempt = Math.max(attempt, fire.attempt);
    if (fire.retry_of_request_id === undefined) break;
    current = fire.retry_of_request_id;
  }
  return attempt;
}

registerScopedService(
  LifecycleScope.Workspace,
  IWorkspaceAutomationService,
  WorkspaceAutomationService,
  ScopeActivation.OnScopeCreated,
  'automations',
);
