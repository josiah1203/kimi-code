import { createHash } from 'node:crypto';

import {
  hostedArtifactSchema,
  legalHoldSchema,
  retentionPolicySchema,
  type ActorRef,
  type HostedArtifact,
  type LegalHold,
  type Principal,
  type RetentionPolicy,
} from '@spiderbyte/commercial-domain';
import {
  CapabilityUnavailableError,
  type AuditWriter,
  type Clock,
  type CommercialStore,
  type HostedArtifactAdapter,
  type IdGenerator,
} from '@spiderbyte/commercial-ports';
import { CommercialEntitlementService } from '@spiderbyte/commercial-billing';

import { CommercialArtifactCodes, CommercialArtifactError } from './errors';

export interface ArtifactAuthorizationGate {
  authorize(
    principal: Principal,
    organizationId: string,
    action: 'artifact.read' | 'artifact.write',
    requestId: string,
    workspaceId: string,
  ): Promise<void>;
}

export interface ArtifactServiceDependencies {
  readonly store: CommercialStore;
  readonly adapter: HostedArtifactAdapter;
  readonly entitlement: CommercialEntitlementService;
  readonly authorize: ArtifactAuthorizationGate;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly audit: AuditWriter;
}

export interface PutArtifactInput {
  readonly principal: Principal;
  readonly account_id: string;
  readonly organization_id: string;
  readonly workspace_id: string;
  readonly run_id?: string;
  readonly name: string;
  readonly media_type: string;
  readonly bytes: Uint8Array;
  readonly retention_policy_id?: string;
  readonly actor: ActorRef;
  readonly request_id: string;
}

export class HostedArtifactService {
  constructor(private readonly deps: ArtifactServiceDependencies) {}

  async createRetentionPolicy(input: {
    readonly account_id: string;
    readonly organization_id: string;
    readonly workspace_id?: string;
    readonly retention_days: number;
    readonly delete_after_expiry: boolean;
    readonly actor: ActorRef;
    readonly request_id: string;
  }): Promise<RetentionPolicy> {
    const now = this.deps.clock.now();
    const policy = retentionPolicySchema.parse({
      id: this.deps.ids.next('retain_'),
      account_id: input.account_id,
      organization_id: input.organization_id,
      workspace_id: input.workspace_id,
      retention_days: input.retention_days,
      delete_after_expiry: input.delete_after_expiry,
      state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: input.actor,
      updated_by: input.actor,
    });
    await this.deps.store.put('retention_policies', policy.id, policy);
    await this.audit(input.account_id, input.organization_id, input.workspace_id, input.actor, 'retention.create', 'retention_policy', policy.id, input.request_id, now);
    return policy;
  }

  async createLegalHold(input: {
    readonly account_id: string;
    readonly organization_id: string;
    readonly artifact_ids: readonly string[];
    readonly reason: string;
    readonly actor: ActorRef;
    readonly request_id: string;
  }): Promise<LegalHold> {
    const artifacts = await this.deps.store.list('hosted_artifacts');
    if (input.artifact_ids.some((id) => {
      const artifact = artifacts.find((candidate) => candidate.id === id);
      return artifact === undefined || artifact.organization_id !== input.organization_id;
    })) {
      throw new CommercialArtifactError(CommercialArtifactCodes.ARTIFACT_NOT_FOUND, 'legal hold contains an artifact outside the organization');
    }
    const now = this.deps.clock.now();
    const hold = legalHoldSchema.parse({
      id: this.deps.ids.next('hold_'),
      account_id: input.account_id,
      organization_id: input.organization_id,
      artifact_ids: input.artifact_ids,
      reason: input.reason,
      state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: input.actor,
      updated_by: input.actor,
    });
    await this.deps.store.put('legal_holds', hold.id, hold);
    await this.audit(input.account_id, input.organization_id, undefined, input.actor, 'legal_hold.create', 'legal_hold', hold.id, input.request_id, now);
    return hold;
  }

  async put(input: PutArtifactInput): Promise<HostedArtifact> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'artifact.write', input.request_id, input.workspace_id);
    await this.deps.entitlement.assertIncluded(input.organization_id, 'hosted_artifacts');
    const capability = this.deps.adapter.capability();
    if (capability.availability !== 'available') throw new CapabilityUnavailableError(capability);
    const bytes = new Uint8Array(input.bytes);
    const contentAddress = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const fingerprint = hashJson({
      account_id: input.account_id,
      organization_id: input.organization_id,
      workspace_id: input.workspace_id,
      run_id: input.run_id,
      name: input.name,
      media_type: input.media_type,
      content_address: contentAddress,
      retention_policy_id: input.retention_policy_id,
    });
    const replay = await this.replayArtifact(input.request_id, fingerprint);
    if (replay !== undefined) return replay;
    const quota = await this.deps.entitlement.evaluate(input.organization_id, 'storage_bytes');
    if (typeof quota.value === 'number') {
      const used = (await this.deps.store.list('hosted_artifacts'))
        .filter((artifact) => artifact.organization_id === input.organization_id && artifact.state !== 'deleted')
        .reduce((total, artifact) => total + artifact.size_bytes, 0);
      if (used + bytes.byteLength > quota.value) {
        throw new CommercialArtifactError(CommercialArtifactCodes.STORAGE_QUOTA_EXCEEDED, 'artifact would exceed the plan storage allowance', {
          limit_bytes: quota.value,
          used_bytes: used,
          requested_bytes: bytes.byteLength,
        });
      }
    }
    if (input.retention_policy_id !== undefined) {
      const policy = await this.deps.store.get('retention_policies', input.retention_policy_id);
      if (policy === undefined || policy.organization_id !== input.organization_id || policy.workspace_id !== undefined && policy.workspace_id !== input.workspace_id) {
        throw new CommercialArtifactError(CommercialArtifactCodes.RETENTION_POLICY_NOT_FOUND, 'retention policy is not available to this workspace');
      }
    }
    const now = this.deps.clock.now();
    const artifactId = this.deps.ids.next('hartifact_');
    const object = await this.deps.adapter.put({
      artifact_id: artifactId,
      organization_id: input.organization_id,
      workspace_id: input.workspace_id,
      content_address: contentAddress,
      bytes,
      request_id: input.request_id,
    });
    const artifact = hostedArtifactSchema.parse({
      id: artifactId,
      account_id: input.account_id,
      organization_id: input.organization_id,
      workspace_id: input.workspace_id,
      run_id: input.run_id,
      name: input.name,
      content_address: contentAddress,
      object_ref: object.object_ref,
      media_type: input.media_type,
      size_bytes: bytes.byteLength,
      state: 'available',
      retention_policy_id: input.retention_policy_id,
      legal_hold_ids: [],
      version: 1,
      created_at: now,
      updated_at: now,
      created_by: input.actor,
      updated_by: input.actor,
    });
    await this.deps.store.transaction(async (store) => {
      await store.put('hosted_artifacts', artifact.id, artifact);
      await this.remember(store, 'artifact.put', input.request_id, fingerprint, artifact);
    });
    await this.audit(input.account_id, input.organization_id, input.workspace_id, input.actor, 'artifact.put', 'artifact', artifact.id, input.request_id, now, { size_bytes: bytes.byteLength });
    return artifact;
  }

  async issueDownload(input: {
    readonly principal: Principal;
    readonly organization_id: string;
    readonly workspace_id: string;
    readonly artifact_id: string;
    readonly expires_at: string;
    readonly actor: ActorRef;
    readonly request_id: string;
  }): Promise<{ readonly url: string; readonly expires_at: string }> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'artifact.read', input.request_id, input.workspace_id);
    const artifact = await this.requireOwned(input.organization_id, input.workspace_id, input.artifact_id);
    if (artifact.state !== 'available') throw new CommercialArtifactError(CommercialArtifactCodes.ARTIFACT_DELETED, 'artifact is not available');
    const capability = this.deps.adapter.capability();
    if (capability.availability !== 'available') throw new CapabilityUnavailableError(capability);
    return this.deps.adapter.issueDownload({
      organization_id: input.organization_id,
      workspace_id: input.workspace_id,
      artifact_id: artifact.id,
      expires_at: input.expires_at,
    });
  }

  async delete(input: {
    readonly principal: Principal;
    readonly organization_id: string;
    readonly workspace_id: string;
    readonly artifact_id: string;
    readonly actor: ActorRef;
    readonly request_id: string;
  }): Promise<HostedArtifact> {
    await this.deps.authorize.authorize(input.principal, input.organization_id, 'artifact.write', input.request_id, input.workspace_id);
    const artifact = await this.requireOwned(input.organization_id, input.workspace_id, input.artifact_id);
    const fingerprint = hashJson({ organization_id: input.organization_id, workspace_id: input.workspace_id, artifact_id: input.artifact_id });
    const replay = await this.replayArtifact(input.request_id, fingerprint, 'artifact.delete');
    if (replay !== undefined) return replay;
    const holds = await this.deps.store.list('legal_holds');
    if (holds.some((hold) => hold.state === 'active' && hold.organization_id === input.organization_id && hold.artifact_ids.includes(artifact.id))) {
      throw new CommercialArtifactError(CommercialArtifactCodes.ARTIFACT_HELD, 'artifact is protected by an active legal hold');
    }
    const capability = this.deps.adapter.capability();
    if (capability.availability !== 'available') throw new CapabilityUnavailableError(capability);
    await this.deps.adapter.delete({
      organization_id: input.organization_id,
      workspace_id: input.workspace_id,
      object_ref: artifact.object_ref,
      request_id: input.request_id,
    });
    const now = this.deps.clock.now();
    const deleted = hostedArtifactSchema.parse({
      ...artifact,
      state: 'deleted',
      deleted_at: now,
      version: artifact.version + 1,
      updated_at: now,
      updated_by: input.actor,
    });
    await this.deps.store.transaction(async (store) => {
      await store.put('hosted_artifacts', deleted.id, deleted);
      await this.remember(store, 'artifact.delete', input.request_id, fingerprint, deleted);
    });
    await this.audit(artifact.account_id, input.organization_id, input.workspace_id, input.actor, 'artifact.delete', 'artifact', deleted.id, input.request_id, now);
    return deleted;
  }

  async expire(at = this.deps.clock.now()): Promise<readonly HostedArtifact[]> {
    const changed: HostedArtifact[] = [];
    for (const artifact of await this.deps.store.list('hosted_artifacts')) {
      if (artifact.state !== 'available' || artifact.retention_policy_id === undefined) continue;
      const policy = await this.deps.store.get('retention_policies', artifact.retention_policy_id);
      if (policy === undefined || !policy.delete_after_expiry) continue;
      const expiresAt = Date.parse(artifact.created_at) + policy.retention_days * 86_400_000;
      if (expiresAt > Date.parse(at)) continue;
      const hold = (await this.deps.store.list('legal_holds')).some((candidate) => candidate.state === 'active' && candidate.artifact_ids.includes(artifact.id));
      if (hold) continue;
      await this.deps.adapter.delete({
        organization_id: artifact.organization_id,
        workspace_id: artifact.workspace_id,
        object_ref: artifact.object_ref,
        request_id: `retention:${artifact.id}`,
      });
      const deleted = hostedArtifactSchema.parse({
        ...artifact,
        state: 'deleted',
        deleted_at: at,
        version: artifact.version + 1,
        updated_at: at,
        updated_by: { kind: 'system', id: 'retention-worker' },
      });
      await this.deps.store.put('hosted_artifacts', deleted.id, deleted);
      changed.push(deleted);
    }
    return changed;
  }

  private async requireOwned(organizationId: string, workspaceId: string, artifactId: string): Promise<HostedArtifact> {
    const artifact = await this.deps.store.get('hosted_artifacts', artifactId);
    if (artifact === undefined || artifact.organization_id !== organizationId || artifact.workspace_id !== workspaceId) {
      throw new CommercialArtifactError(CommercialArtifactCodes.ARTIFACT_NOT_FOUND, 'artifact is not available to this workspace');
    }
    return artifact;
  }

  private async replayArtifact(requestId: string, fingerprint: string, scope = 'artifact.put'): Promise<HostedArtifact | undefined> {
    const record = await this.deps.store.get('idempotency', `${scope}:${requestId}`);
    if (record === undefined) return undefined;
    if (record.fingerprint !== fingerprint) throw new CommercialArtifactError(CommercialArtifactCodes.IDEMPOTENCY_REUSED, 'request id was reused with different artifact input');
    return JSON.parse(record.result_json) as HostedArtifact;
  }

  private async remember(store: CommercialStore, scope: string, requestId: string, fingerprint: string, artifact: HostedArtifact): Promise<void> {
    await store.put('idempotency', `${scope}:${requestId}`, {
      scope,
      request_id: requestId,
      fingerprint,
      result_json: JSON.stringify(artifact),
      created_at: this.deps.clock.now(),
    });
  }

  private async audit(
    accountId: string,
    organizationId: string,
    workspaceId: string | undefined,
    actor: ActorRef,
    action: string,
    targetType: string,
    targetId: string,
    requestId: string,
    occurredAt: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.audit.append({
      account_id: accountId,
      organization_id: organizationId,
      workspace_id: workspaceId,
      actor,
      action,
      target_type: targetType,
      target_id: targetId,
      outcome: 'succeeded',
      request_id: requestId,
      occurred_at: occurredAt,
      detail,
    });
  }
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
