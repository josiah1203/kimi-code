import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IPlatformIdentityService } from '#/app/platformIdentity/platformIdentity';
import { PlatformIdentityService } from '#/app/platformIdentity/platformIdentityService';

describe('PlatformIdentityService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    ix.stub(IBootstrapService, {
      _serviceBrand: undefined,
      getEnv: () => undefined,
      scope: (name: string) => `/tmp/spiderbyte-${name}`,
    } as unknown as IBootstrapService);
    ix.set(IPlatformIdentityService, new SyncDescriptor(PlatformIdentityService));
  });

  afterEach(() => {
    disposables.dispose();
  });

  it('reports accountless local mode without a hosted authority', async () => {
    const service = ix.get(IPlatformIdentityService);
    await expect(service.status()).resolves.toMatchObject({
      mode: 'local',
      authenticated: false,
      credential_class: 'account',
    });
    await expect(service.logout()).resolves.toMatchObject({
      logged_out: true,
      identity: { mode: 'local', authenticated: false },
    });
  });

  it('fails hosted login explicitly instead of creating a local impersonation', async () => {
    const service = ix.get(IPlatformIdentityService);
    await expect(service.startPkce()).rejects.toMatchObject({
      code: 'identity.hosted_not_configured',
    });
    await expect(service.startDevice()).rejects.toMatchObject({
      code: 'identity.hosted_not_configured',
    });
  });
});
