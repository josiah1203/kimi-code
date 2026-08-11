/**
 * `platformSecrets` domain — the process-local secret store for platform
 * provider credentials.
 *
 * Keeps raw credential material in the credentials persistence scope, separate
 * from workspace platform projections, and exposes only opaque references to
 * callers. Bound at App scope so workspace handlers share one vault without
 * sharing any provider-registry state.
 */

import { ulid } from 'ulid';
import { z } from 'zod';

import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Disposable } from '#/_base/di/lifecycle';
import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import {
  providerSecretRefSchema,
  type ProviderSecretRef,
} from '@spiderbyte/protocol';

const SECRETS_KEY = 'platform-secrets.json';
const DOCUMENT_VERSION = 1;
const MAX_SECRET_BYTES = 64 * 1024;

const secretsDocumentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  secrets: z.record(providerSecretRefSchema, z.string().min(1).max(MAX_SECRET_BYTES)),
});

type SecretsDocument = z.infer<typeof secretsDocumentSchema>;

export interface IPlatformSecretStore {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;

  /** Stores new material and returns the only identifier exposed to platform records. */
  put(secret: string): Promise<ProviderSecretRef>;
  /** Replaces material for an existing reference without changing the reference. */
  set(reference: ProviderSecretRef, secret: string): Promise<void>;
  /** Resolves material only at an execution/provider boundary. */
  get(reference: ProviderSecretRef): Promise<string | undefined>;
  remove(reference: ProviderSecretRef): Promise<void>;
}

export const IPlatformSecretStore: ServiceIdentifier<IPlatformSecretStore> =
  createDecorator<IPlatformSecretStore>('platformSecretStore');

export class PlatformSecretStore extends Disposable implements IPlatformSecretStore {
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;

  private readonly scope: string;
  private secrets: Record<ProviderSecretRef, string> = {};
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IBootstrapService bootstrap: IBootstrapService,
  ) {
    super();
    this.scope = `${bootstrap.scope('credentials')}/platform`;
    this.ready = this.load();
  }

  async put(secret: string): Promise<ProviderSecretRef> {
    assertSecret(secret);
    return this.enqueue(async () => {
      await this.ready;
      const reference = `secret_${ulid()}` as ProviderSecretRef;
      await this.replace({ ...this.secrets, [reference]: secret });
      return reference;
    });
  }

  async set(reference: ProviderSecretRef, secret: string): Promise<void> {
    providerSecretRefSchema.parse(reference);
    assertSecret(secret);
    return this.enqueue(async () => {
      await this.ready;
      await this.replace({ ...this.secrets, [reference]: secret });
    });
  }

  async get(reference: ProviderSecretRef): Promise<string | undefined> {
    providerSecretRefSchema.parse(reference);
    await this.ready;
    return this.secrets[reference];
  }

  async remove(reference: ProviderSecretRef): Promise<void> {
    providerSecretRefSchema.parse(reference);
    return this.enqueue(async () => {
      await this.ready;
      if (!(reference in this.secrets)) return;
      const next = { ...this.secrets };
      delete next[reference];
      await this.replace(next);
    });
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, SECRETS_KEY);
    if (raw === undefined) {
      await this.replace({});
      return;
    }
    const document = secretsDocumentSchema.parse(raw);
    this.secrets = document.secrets;
  }

  private async replace(secrets: Record<ProviderSecretRef, string>): Promise<void> {
    const document: SecretsDocument = {
      version: DOCUMENT_VERSION,
      secrets,
    };
    await this.store.set(this.scope, SECRETS_KEY, document);
    this.secrets = secrets;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(work, work);
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function assertSecret(secret: string): void {
  if (typeof secret !== 'string' || secret.trim().length === 0) {
    throw new Error('provider secret must not be empty');
  }
  if (new TextEncoder().encode(secret).byteLength > MAX_SECRET_BYTES) {
    throw new Error('provider secret exceeds the maximum supported size');
  }
}

registerScopedService(
  LifecycleScope.App,
  IPlatformSecretStore,
  PlatformSecretStore,
  ScopeActivation.OnDemand,
  'platformSecrets',
);
