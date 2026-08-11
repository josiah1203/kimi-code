import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { JsonAtomicDocumentStore } from '#/persistence/backends/node-fs/atomicDocumentStore';
import { IFileSystemStorageService } from '#/persistence/interface/storage';
import { InMemoryStorageService } from '#/persistence/backends/memory/inMemoryStorageService';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import {
  IPlatformSecretStore,
  PlatformSecretStore,
} from '#/app/secrets/platformSecretStore';

describe('PlatformSecretStore', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    ix.stub(IBootstrapService, {
      _serviceBrand: undefined,
      scope: (name: string) => (name === 'credentials' ? 'credentials' : name),
    } as unknown as IBootstrapService);
    ix.set(IFileSystemStorageService, new SyncDescriptor(InMemoryStorageService));
    ix.set(IAtomicDocumentStore, new SyncDescriptor(JsonAtomicDocumentStore));
    ix.set(IPlatformSecretStore, new SyncDescriptor(PlatformSecretStore));
  });

  afterEach(() => disposables.dispose());

  it('persists raw material only in the credentials scope and returns opaque refs', async () => {
    const service = ix.get(IPlatformSecretStore);
    const reference = await service.put('sk-example-secret');

    expect(reference).toMatch(/^secret_/);
    await expect(service.get(reference)).resolves.toBe('sk-example-secret');

    const docs = ix.get(IAtomicDocumentStore);
    const stored = await docs.get<unknown>('credentials/platform', 'platform-secrets.json');
    expect(JSON.stringify(stored)).toContain('sk-example-secret');
    expect(JSON.stringify(stored)).not.toContain('provider_connection');

    const fresh = disposables.add(ix.createInstance(PlatformSecretStore));
    await expect(fresh.get(reference)).resolves.toBe('sk-example-secret');
  });

  it('replaces and removes a credential without changing its public reference', async () => {
    const service = ix.get(IPlatformSecretStore);
    const reference = await service.put('first');
    await service.set(reference, 'second');
    await expect(service.get(reference)).resolves.toBe('second');
    await service.remove(reference);
    await expect(service.get(reference)).resolves.toBeUndefined();
  });
});
