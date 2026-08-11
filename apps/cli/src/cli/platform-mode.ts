import type { ExperimentalFeatureState } from '@spiderbyte/sdk';

export const PLATFORM_SERVICES_FLAG_ID = 'platform_services';

export function platformFeatureFrom(
  features: readonly ExperimentalFeatureState[],
): ExperimentalFeatureState | undefined {
  return features.find((feature) => feature.id === PLATFORM_SERVICES_FLAG_ID);
}

export function formatPlatformModeDiagnostic(
  feature: Pick<ExperimentalFeatureState, 'enabled' | 'source' | 'env' | 'emergencyDisableEnv'> | undefined,
): string {
  if (feature?.enabled === true) {
    const source = feature.source === 'default' ? 'default-on' : `via ${feature.source}`;
    return `SpiderByte platform mode: canonical Workspace, AgentSession, Run, ProviderConnection, ModelRef, Artifact, and UsageEvent services are enabled (${source}).`;
  }

  if (feature?.source === 'emergency-disable-env') {
    return `SpiderByte rollback mode: platform services are disabled by ${feature.emergencyDisableEnv ?? 'SPIDERBYTE_DISABLE_PLATFORM_SERVICES'}. Local agent execution remains available.`;
  }

  const control = feature?.env ?? 'SPIDERBYTE_EXPERIMENTAL_PLATFORM_SERVICES';
  return `SpiderByte platform warning: platform services are disabled by ${control}. Configure the local platform before relying on workspace runs.`;
}
