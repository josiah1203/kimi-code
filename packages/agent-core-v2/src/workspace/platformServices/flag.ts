/**
 * `platformServices` domain — registers the experimental platform backend flag.
 *
 * The flag gates the new workspace platform behavior while the contracts and
 * local persistence surface mature. App-scoped.
 */

import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const PLATFORM_SERVICES_FLAG_ID = 'platform_services';
export const PLATFORM_SERVICES_FLAG_ENV = 'KIMI_CODE_EXPERIMENTAL_PLATFORM_SERVICES';

export const platformServicesFlag: FlagDefinitionInput = {
  id: PLATFORM_SERVICES_FLAG_ID,
  title: 'Workspace platform services',
  description:
    'Enable durable provider, policy, resource, artifact, execution-target, automation, and commercial workspace services.',
  env: PLATFORM_SERVICES_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(platformServicesFlag);
