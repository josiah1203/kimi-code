/** SpiderByte account identity contract — App scope. */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type {
  PlatformIdentityDevicePollInput,
  PlatformIdentityDevicePollResult,
  PlatformIdentityDeviceStart,
  PlatformIdentityLogoutResult,
  PlatformIdentityPkceCompleteInput,
  PlatformIdentityPkceStart,
  PlatformIdentityStatus,
} from '@moonshot-ai/protocol';

export interface IPlatformIdentityService {
  readonly _serviceBrand: undefined;
  status(): Promise<PlatformIdentityStatus>;
  startPkce(): Promise<PlatformIdentityPkceStart>;
  completePkce(input: PlatformIdentityPkceCompleteInput): Promise<PlatformIdentityStatus>;
  startDevice(): Promise<PlatformIdentityDeviceStart>;
  pollDevice(input: PlatformIdentityDevicePollInput): Promise<PlatformIdentityDevicePollResult>;
  logout(): Promise<PlatformIdentityLogoutResult>;
  /** Used only by hosted control-plane adapters; never part of a projection. */
  getAccessToken(): Promise<string | undefined>;
}

export const IPlatformIdentityService: ServiceIdentifier<IPlatformIdentityService> =
  createDecorator<IPlatformIdentityService>('platformIdentityService');
