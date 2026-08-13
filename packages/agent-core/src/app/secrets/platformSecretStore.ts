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
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

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
const DOCUMENT_VERSION = 2;
const MAX_SECRET_BYTES = 64 * 1024;
const SECRET_KEY_BYTES = 32;
const SECRET_NONCE_BYTES = 12;
const SECRET_STORE_ALGORITHM = 'aes-256-gcm';
const SECRET_STORE_AAD = Buffer.from('spiderbyte.platform-secrets.v2', 'utf8');

/** Environment-provided key for local credential encryption at rest. */
export const SPIDERBYTE_SECRET_STORE_KEY_ENV = 'SPIDERBYTE_SECRET_STORE_KEY';

const secretsPayloadSchema = z.record(providerSecretRefSchema, z.string().min(1).max(MAX_SECRET_BYTES));

const encryptedSecretsDocumentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  algorithm: z.literal(SECRET_STORE_ALGORITHM),
  nonce: z.string().min(1),
  ciphertext: z.string().min(1),
  auth_tag: z.string().min(1),
});

const legacySecretsDocumentSchema = z.strictObject({
  version: z.literal(1),
  secrets: z.record(providerSecretRefSchema, z.string().min(1).max(MAX_SECRET_BYTES)),
});

type SecretsDocument = z.infer<typeof encryptedSecretsDocumentSchema>;
type LegacySecretsDocument = z.infer<typeof legacySecretsDocumentSchema>;

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
  private readonly encryptionKey: Buffer | undefined;
  private secrets: Record<ProviderSecretRef, string> = {};
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IBootstrapService bootstrap: IBootstrapService,
  ) {
    super();
    this.scope = `${bootstrap.scope('credentials')}/platform`;
    this.encryptionKey = readEncryptionKey();
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
      return;
    }
    const document = z.union([encryptedSecretsDocumentSchema, legacySecretsDocumentSchema]).parse(raw);
    if (isLegacySecretsDocument(document)) {
      this.secrets = document.secrets;
      // Migrate an existing plaintext document immediately. If no key is
      // configured, `encryptionKeyOrThrow` fails before any credential is
      // exposed to a caller.
      await this.replace(this.secrets);
      return;
    }
    this.secrets = decryptSecrets(document, this.encryptionKey);
  }

  private async replace(secrets: Record<ProviderSecretRef, string>): Promise<void> {
    const key = encryptionKeyOrThrow(this.encryptionKey);
    const nonce = randomBytes(SECRET_NONCE_BYTES);
    const cipher = createCipheriv(SECRET_STORE_ALGORITHM, key, nonce);
    cipher.setAAD(SECRET_STORE_AAD);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(secrets), 'utf8'),
      cipher.final(),
    ]);
    const document: SecretsDocument = {
      version: DOCUMENT_VERSION,
      algorithm: SECRET_STORE_ALGORITHM,
      nonce: nonce.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      auth_tag: cipher.getAuthTag().toString('base64url'),
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

function isLegacySecretsDocument(
  document: SecretsDocument | LegacySecretsDocument,
): document is LegacySecretsDocument {
  return document.version === 1;
}

function readEncryptionKey(): Buffer | undefined {
  const value = process.env[SPIDERBYTE_SECRET_STORE_KEY_ENV]?.trim();
  if (value === undefined || value.length === 0) return undefined;
  const decoded = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64url');
  if (decoded.length !== SECRET_KEY_BYTES) {
    throw new Error(
      `${SPIDERBYTE_SECRET_STORE_KEY_ENV} must encode exactly ${SECRET_KEY_BYTES} bytes as hex or base64url`,
    );
  }
  return decoded;
}

function encryptionKeyOrThrow(key: Buffer | undefined): Buffer {
  if (key === undefined) {
    throw new Error(
      `provider credentials require ${SPIDERBYTE_SECRET_STORE_KEY_ENV}; refusing plaintext local secret persistence`,
    );
  }
  return key;
}

function decryptSecrets(document: SecretsDocument, key: Buffer | undefined): Record<ProviderSecretRef, string> {
  try {
    const decipher = createDecipheriv(
      document.algorithm,
      encryptionKeyOrThrow(key),
      Buffer.from(document.nonce, 'base64url'),
    );
    decipher.setAAD(SECRET_STORE_AAD);
    decipher.setAuthTag(Buffer.from(document.auth_tag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(document.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return secretsPayloadSchema.parse(JSON.parse(plaintext));
  } catch {
    throw new Error(
      'provider credential store could not be decrypted; configure the original local encryption key',
    );
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
