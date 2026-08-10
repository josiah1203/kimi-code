import type { ExperimentalFeatureState } from '@moonshot-ai/kimi-code-sdk';

export const PLATFORM_SERVICES_FLAG_ID = 'platform_services';

export function platformFeatureFrom(
  features: readonly ExperimentalFeatureState[],
): ExperimentalFeatureState | undefined {
  return features.find((feature) => feature.id === PLATFORM_SERVICES_FLAG_ID);
}

export function formatPlatformModeDiagnostic(
  engineV2: boolean,
  feature: Pick<ExperimentalFeatureState, 'enabled' | 'source' | 'env' | 'emergencyDisableEnv'> | undefined,
): string {
  if (!engineV2) {
    return 'SpiderByte compatibility mode: the legacy Kimi engine is active. Platform services are unavailable; this was requested by KIMI_CODE_LEGACY_FLAG.';
  }

  if (feature?.enabled === true) {
    const source = feature.source === 'default' ? 'default-on' : `via ${feature.source}`;
    return `SpiderByte platform mode: canonical Workspace, AgentSession, Run, ProviderConnection, ModelRef, Artifact, and UsageEvent services are enabled (${source}).`;
  }

  if (feature?.source === 'emergency-disable-env') {
    return `SpiderByte rollback mode: platform services are disabled by ${feature.emergencyDisableEnv ?? 'KIMI_CODE_DISABLE_PLATFORM_SERVICES'}. Legacy compatibility paths remain available with explicit warnings.`;
  }

  const control = feature?.env ?? 'KIMI_CODE_EXPERIMENTAL_PLATFORM_SERVICES';
  return `SpiderByte compatibility warning: platform services are disabled by ${control}. Configure the platform before relying on Business Runs.`;
}
