import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    vi.stubEnv('SPIDERBYTE_SECRET_STORE_KEY', Buffer.alloc(32, 7).toString('base64url'));
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

  afterEach(() => {
    disposables.dispose();
    vi.unstubAllEnvs();
  });

  it('encrypts raw material in the credentials scope and returns opaque refs', async () => {
    const service = ix.get(IPlatformSecretStore);
    const reference = await service.put('sk-example-secret');

    expect(reference).toMatch(/^secret_/);
    await expect(service.get(reference)).resolves.toBe('sk-example-secret');

    const docs = ix.get(IAtomicDocumentStore);
    const stored = await docs.get<unknown>('credentials/platform', 'platform-secrets.json');
    expect(stored).toMatchObject({ version: 2, algorithm: 'aes-256-gcm' });
    expect(JSON.stringify(stored)).not.toContain('sk-example-secret');
    expect(JSON.stringify(stored)).not.toContain('provider_connection');

    const fresh = disposables.add(ix.createInstance(PlatformSecretStore));
    await expect(fresh.get(reference)).resolves.toBe('sk-example-secret');
  });

  it('migrates a legacy plaintext document only when encryption is available', async () => {
    const docs = ix.get(IAtomicDocumentStore);
    await docs.set('credentials/platform', 'platform-secrets.json', {
      version: 1,
      secrets: { secret_legacy: 'legacy-secret' },
    });

    const service = ix.createInstance(PlatformSecretStore);
    await expect(service.get('secret_legacy')).resolves.toBe('legacy-secret');
    const stored = await docs.get<unknown>('credentials/platform', 'platform-secrets.json');
    expect(stored).toMatchObject({ version: 2, algorithm: 'aes-256-gcm' });
    expect(JSON.stringify(stored)).not.toContain('legacy-secret');
  });

  it('fails closed instead of creating plaintext credentials without a key', async () => {
    vi.stubEnv('SPIDERBYTE_SECRET_STORE_KEY', '');
    const service = ix.get(IPlatformSecretStore);
    await expect(service.put('secret-without-key')).rejects.toThrow(
      'refusing plaintext local secret persistence',
    );
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
