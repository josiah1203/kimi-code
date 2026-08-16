export interface PlatformProjectWorkspaceBinding {
  readonly organization_id: string;
  readonly project_id: string;
  readonly workspace_id: string;
}

export interface PlatformProjectWorkspaceBindingCapability {
  readonly capability: 'platform_project_workspace_binding';
  readonly availability: 'available' | 'not_configured';
  readonly adapter: 'kap-server-hosted-project-workspace-binding';
  readonly reason: string;
}

export function parsePlatformProjectWorkspaceBindings(
  raw: string | undefined,
): readonly PlatformProjectWorkspaceBinding[] {
  if (raw === undefined || raw.trim().length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('SPIDERBYTE_PLATFORM_PROJECT_WORKSPACE_BINDINGS_JSON must be valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new TypeError('SPIDERBYTE_PLATFORM_PROJECT_WORKSPACE_BINDINGS_JSON must be a JSON array');
  }
  const bindings = parsed.map((value, index) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`platform project/workspace binding ${index} must be an object`);
    }
    const record = value as Record<string, unknown>;
    const organizationId = record['organization_id'];
    const projectId = record['project_id'];
    const workspaceId = record['workspace_id'];
    if (
      typeof organizationId !== 'string' || organizationId.length === 0 ||
      typeof projectId !== 'string' || projectId.length === 0 ||
      typeof workspaceId !== 'string' || workspaceId.length === 0
    ) {
      throw new Error(`platform project/workspace binding ${index} must include non-empty organization_id, project_id, and workspace_id`);
    }
    return {
      organization_id: organizationId,
      project_id: projectId,
      workspace_id: workspaceId,
    } satisfies PlatformProjectWorkspaceBinding;
  });
  const keys = new Set<string>();
  for (const binding of bindings) {
    const key = `${binding.organization_id}:${binding.project_id}:${binding.workspace_id}`;
    if (keys.has(key)) throw new Error(`duplicate platform project/workspace binding: ${key}`);
    keys.add(key);
  }
  return bindings;
}

export function platformProjectWorkspaceBindingCapability(
  bridgeConfigured: boolean,
  raw: string | undefined,
): PlatformProjectWorkspaceBindingCapability {
  try {
    const bindings = parsePlatformProjectWorkspaceBindings(raw);
    return {
      capability: 'platform_project_workspace_binding',
      availability: bridgeConfigured && bindings.length > 0 ? 'available' : 'not_configured',
      adapter: 'kap-server-hosted-project-workspace-binding',
      reason: bridgeConfigured && bindings.length > 0
        ? `${bindings.length} approved project/workspace mapping${bindings.length === 1 ? '' : 's'} configured`
        : bridgeConfigured
          ? 'No approved project/workspace mappings are configured'
          : 'The platform organization bridge must be configured before project/workspace mappings can be applied',
    };
  } catch (error) {
    return {
      capability: 'platform_project_workspace_binding',
      availability: 'not_configured',
      adapter: 'kap-server-hosted-project-workspace-binding',
      reason: error instanceof Error ? error.message : 'platform project/workspace binding configuration is invalid',
    };
  }
}
