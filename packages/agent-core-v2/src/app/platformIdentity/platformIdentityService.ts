/** Configurable SpiderByte OAuth/OIDC identity authority — App scope. */

import { ulid } from 'ulid';
import { join } from 'pathe';

import {
  FileSpiderByteTokenStorage,
  SpiderByteIdentityClient,
  SpiderByteIdentityError,
  type SpiderByteIdentityConfig,
} from '@moonshot-ai/kimi-code-oauth';
import {
  nowIsoDateTime,
  platformIdentityDevicePollResultSchema,
  platformIdentityDeviceStartSchema,
  platformIdentityLogoutResultSchema,
  platformIdentityPkceStartSchema,
  platformIdentityStatusSchema,
  type PlatformIdentityDevicePollInput,
  type PlatformIdentityDevicePollResult,
  type PlatformIdentityDeviceStart,
  type PlatformIdentityLogoutResult,
  type PlatformIdentityPkceCompleteInput,
  type PlatformIdentityPkceStart,
  type PlatformIdentityStatus,
} from '@moonshot-ai/protocol';

import { Disposable } from '#/_base/di/lifecycle';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';

import { PlatformIdentityErrors, PlatformIdentityServiceError } from './errors';
import { IPlatformIdentityService } from './platformIdentity';

const FLOW_TTL_MS = 5 * 60 * 1000;

interface PkceFlow {
  readonly state: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly expiresAt: number;
}

interface DeviceFlow {
  readonly deviceCode: string;
  interval: number;
  readonly expiresAt: number;
}

export class PlatformIdentityService extends Disposable implements IPlatformIdentityService {
  declare readonly _serviceBrand: undefined;

  private readonly client: SpiderByteIdentityClient | undefined;
  private readonly pkceFlows = new Map<string, PkceFlow>();
  private readonly deviceFlows = new Map<string, DeviceFlow>();

  constructor(@IBootstrapService bootstrap: IBootstrapService) {
    super();
    const config = readIdentityConfig(bootstrap);
    this.client =
      config === undefined
        ? undefined
        : new SpiderByteIdentityClient({
            config,
            storage: new FileSpiderByteTokenStorage(join(bootstrap.scope('credentials'), 'spiderbyte-account')),
          });
  }

  async status(): Promise<PlatformIdentityStatus> {
    if (this.client === undefined) return localStatus();
    const status = await this.client.status();
    return platformIdentityStatusSchema.parse({
      mode: 'hosted',
      authenticated: status.authenticated,
      credential_class: 'account',
      authority: status.authority,
      expires_at: status.expiresAt,
    });
  }

  async startPkce(): Promise<PlatformIdentityPkceStart> {
    const client = this.requireClient();
    const request = await client.createAuthorizationRequest();
    const flowId = `identity_flow_${ulid()}`;
    this.pkceFlows.set(flowId, {
      state: request.state,
      codeVerifier: request.codeVerifier,
      redirectUri: request.redirectUri,
      expiresAt: Date.now() + FLOW_TTL_MS,
    });
    return platformIdentityPkceStartSchema.parse({
      flow_id: flowId,
      authorization_url: request.url,
      state: request.state,
      code_verifier: request.codeVerifier,
      redirect_uri: request.redirectUri,
      expires_at: new Date(Date.now() + FLOW_TTL_MS).toISOString(),
    });
  }

  async completePkce(input: PlatformIdentityPkceCompleteInput): Promise<PlatformIdentityStatus> {
    const client = this.requireClient();
    const flow = this.pkceFlows.get(input.flow_id);
    if (flow === undefined) {
      throw new PlatformIdentityServiceError(
        PlatformIdentityErrors.codes.IDENTITY_FLOW_NOT_FOUND,
        `identity flow not found: ${input.flow_id}`,
      );
    }
    if (flow.expiresAt <= Date.now()) {
      this.pkceFlows.delete(input.flow_id);
      throw new PlatformIdentityServiceError(
        PlatformIdentityErrors.codes.IDENTITY_FLOW_EXPIRED,
        `identity flow expired: ${input.flow_id}`,
      );
    }
    if (input.state !== flow.state) {
      throw new PlatformIdentityServiceError(
        PlatformIdentityErrors.codes.IDENTITY_STATE_MISMATCH,
        'identity OAuth state did not match the pending flow',
      );
    }
    await client.exchangeAuthorizationCode(input.code, flow.codeVerifier, flow.redirectUri);
    this.pkceFlows.delete(input.flow_id);
    return this.status();
  }

  async startDevice(): Promise<PlatformIdentityDeviceStart> {
    const client = this.requireClient();
    const device = await client.requestDeviceAuthorization();
    const flowId = `identity_flow_${ulid()}`;
    this.deviceFlows.set(flowId, {
      deviceCode: device.deviceCode,
      interval: device.interval,
      expiresAt: Date.now() + device.expiresIn * 1000,
    });
    return platformIdentityDeviceStartSchema.parse({
      flow_id: flowId,
      device_code: device.deviceCode,
      user_code: device.userCode,
      verification_uri: device.verificationUri,
      verification_uri_complete: device.verificationUriComplete,
      expires_in: device.expiresIn,
      interval: device.interval,
    });
  }

  async pollDevice(input: PlatformIdentityDevicePollInput): Promise<PlatformIdentityDevicePollResult> {
    const client = this.requireClient();
    const flow = this.deviceFlows.get(input.flow_id);
    if (flow === undefined) {
      throw new PlatformIdentityServiceError(
        PlatformIdentityErrors.codes.IDENTITY_FLOW_NOT_FOUND,
        `identity flow not found: ${input.flow_id}`,
      );
    }
    if (flow.expiresAt <= Date.now()) {
      this.deviceFlows.delete(input.flow_id);
      return { status: 'expired' };
    }
    const result = await client.pollDeviceAuthorization(flow.deviceCode);
    if (result.kind === 'pending') {
      if (result.errorCode === 'slow_down') flow.interval += 5;
      return platformIdentityDevicePollResultSchema.parse({
        status: 'pending',
        retry_after: flow.interval,
      });
    }
    this.deviceFlows.delete(input.flow_id);
    if (result.kind === 'expired') return { status: 'expired' };
    if (result.kind === 'denied') return { status: 'denied', reason: result.description };
    return platformIdentityDevicePollResultSchema.parse({
      status: 'authenticated',
      identity: await this.status(),
    });
  }

  async logout(): Promise<PlatformIdentityLogoutResult> {
    if (this.client !== undefined) await this.client.revoke();
    this.pkceFlows.clear();
    this.deviceFlows.clear();
    return platformIdentityLogoutResultSchema.parse({ logged_out: true, identity: await this.status() });
  }

  getAccessToken(): Promise<string | undefined> {
    return this.client?.getAccessToken() ?? Promise.resolve(undefined);
  }

  private requireClient(): SpiderByteIdentityClient {
    if (this.client === undefined) {
      throw new PlatformIdentityServiceError(
        PlatformIdentityErrors.codes.IDENTITY_HOSTED_NOT_CONFIGURED,
        'hosted SpiderByte identity is not configured',
      );
    }
    return this.client;
  }
}

function readIdentityConfig(bootstrap: IBootstrapService): SpiderByteIdentityConfig | undefined {
  const value = (name: string): string | undefined => bootstrap.getEnv(name);
  const issuer = value('SPIDERBYTE_AUTH_ISSUER');
  const clientId = value('SPIDERBYTE_AUTH_CLIENT_ID');
  if (issuer === undefined || clientId === undefined) return undefined;
  return {
    issuer,
    clientId,
    scope: value('SPIDERBYTE_AUTH_SCOPE'),
    redirectUri: value('SPIDERBYTE_AUTH_REDIRECT_URI'),
    authorizationEndpoint: value('SPIDERBYTE_AUTH_AUTHORIZATION_ENDPOINT'),
    tokenEndpoint: value('SPIDERBYTE_AUTH_TOKEN_ENDPOINT'),
    deviceAuthorizationEndpoint: value('SPIDERBYTE_AUTH_DEVICE_AUTHORIZATION_ENDPOINT'),
    revocationEndpoint: value('SPIDERBYTE_AUTH_REVOCATION_ENDPOINT'),
    userInfoEndpoint: value('SPIDERBYTE_AUTH_USERINFO_ENDPOINT'),
  };
}

function localStatus(): PlatformIdentityStatus {
  return platformIdentityStatusSchema.parse({
    mode: 'local',
    authenticated: false,
    credential_class: 'account',
  });
}

registerScopedService(
  LifecycleScope.App,
  IPlatformIdentityService,
  PlatformIdentityService,
  ScopeActivation.OnScopeCreated,
  'platformIdentity',
);
