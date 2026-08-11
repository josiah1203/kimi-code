/**
 * `platformServices` domain — registers the default-on platform backend flag.
 *
 * The per-feature environment variable remains a compatibility override. The
 * separate emergency-disable environment is stronger than the master enable
 * switch so operators can roll back the platform without deleting data.
 * App-scoped.
 */

import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const PLATFORM_SERVICES_FLAG_ID = 'platform_services';
export const PLATFORM_SERVICES_FLAG_ENV = 'SPIDERBYTE_EXPERIMENTAL_PLATFORM_SERVICES';
export const PLATFORM_SERVICES_EMERGENCY_DISABLE_ENV = 'SPIDERBYTE_DISABLE_PLATFORM_SERVICES';

export const platformServicesFlag: FlagDefinitionInput = {
  id: PLATFORM_SERVICES_FLAG_ID,
  title: 'Workspace platform services',
  description:
    'Use durable SpiderByte provider, policy, resource, artifact, execution-target, automation, usage, and ML services for new work.',
  env: PLATFORM_SERVICES_FLAG_ENV,
  emergencyDisableEnv: PLATFORM_SERVICES_EMERGENCY_DISABLE_ENV,
  default: true,
  surface: 'core',
};

registerFlagDefinition(platformServicesFlag);
