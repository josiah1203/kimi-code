import {
  capabilityStatusSchema,
  nowIsoDateTime,
  type CapabilityStatus,
  type OrganizationId,
  type WorkspaceId,
} from '@spiderbyte/commercial-domain';
import {
  CapabilityUnavailableError,
  type HostedArtifactAdapter,
} from '@spiderbyte/commercial-ports';

/** In-memory artifact adapter for deterministic tests. It is never a hosted storage claim. */
export class LocalTestArtifactAdapter implements HostedArtifactAdapter {
  readonly adapter_name = 'local-test-artifacts';
  private readonly objects = new Map<string, Uint8Array>();

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'hosted_artifacts',
      availability: 'available',
      adapter: this.adapter_name,
      reason: 'deterministic in-memory artifact adapter; not a production object store',
      checked_at: nowIsoDateTime(),
    });
  }

  async put(input: {
    readonly artifact_id: string;
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly content_address: string;
    readonly bytes: Uint8Array;
    readonly request_id: string;
  }): Promise<{ readonly object_ref: string }> {
    const objectRef = `test-object:${input.organization_id}:${input.workspace_id}:${input.artifact_id}`;
    this.objects.set(objectRef, new Uint8Array(input.bytes));
    return { object_ref: objectRef };
  }

  async delete(input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly object_ref: string;
    readonly request_id: string;
  }): Promise<void> {
    this.objects.delete(input.object_ref);
  }

  async issueDownload(input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly artifact_id: string;
    readonly expires_at: string;
  }): Promise<{ readonly url: string; readonly expires_at: string }> {
    return {
      url: `test-download:${input.organization_id}:${input.workspace_id}:${input.artifact_id}`,
      expires_at: input.expires_at,
    };
  }

  hasObject(objectRef: string): boolean {
    return this.objects.has(objectRef);
  }
}

export class UnavailableArtifactAdapter implements HostedArtifactAdapter {
  readonly adapter_name = 'unavailable-artifacts';

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'hosted_artifacts',
      availability: 'not_configured',
      adapter: this.adapter_name,
      reason: 'hosted object storage is not configured',
      checked_at: nowIsoDateTime(),
    });
  }

  async put(_input: Parameters<HostedArtifactAdapter['put']>[0]): Promise<{ readonly object_ref: string }> {
    throw new CapabilityUnavailableError(this.capability());
  }

  async delete(_input: Parameters<HostedArtifactAdapter['delete']>[0]): Promise<void> {
    throw new CapabilityUnavailableError(this.capability());
  }

  async issueDownload(_input: Parameters<HostedArtifactAdapter['issueDownload']>[0]): Promise<{ readonly url: string; readonly expires_at: string }> {
    throw new CapabilityUnavailableError(this.capability());
  }
}
