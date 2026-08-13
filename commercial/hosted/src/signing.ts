import type { OrganizationId, WorkspaceId } from '@spiderbyte/commercial-domain';

import type { ArtifactDownloadSigner } from './cloudflare';

const encoder = new TextEncoder();

export class HmacArtifactDownloadSigner implements ArtifactDownloadSigner {
  constructor(
    private readonly secret: string,
    private readonly publicOrigin: string,
  ) {
    if (secret.length < 32) throw new Error('artifact download signing secret must be at least 32 characters');
    if (!/^https:\/\//i.test(publicOrigin)) throw new Error('artifact download origin must use HTTPS');
  }

  async sign(input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly artifact_id: string;
    readonly expires_at: string;
  }): Promise<string> {
    const path = '/api/v1/commercial/artifacts/download';
    const expires = String(Date.parse(input.expires_at));
    if (!Number.isFinite(Number(expires)) || Number(expires) <= Date.now()) throw new Error('artifact download expiry must be in the future');
    const canonical = canonicalDownloadRequest(path, input.organization_id, input.workspace_id, input.artifact_id, expires);
    const signature = await sign(this.secret, canonical);
    const url = new URL(path, this.publicOrigin);
    url.searchParams.set('organization_id', input.organization_id);
    url.searchParams.set('workspace_id', input.workspace_id);
    url.searchParams.set('artifact_id', input.artifact_id);
    url.searchParams.set('expires', expires);
    url.searchParams.set('signature', signature);
    return url.toString();
  }

  async verify(input: {
    readonly path: string;
    readonly organization_id: string;
    readonly workspace_id: string;
    readonly artifact_id: string;
    readonly expires: string;
    readonly signature: string;
  }): Promise<boolean> {
    const expires = Number(input.expires);
    if (!Number.isSafeInteger(expires) || expires <= Date.now()) return false;
    const expected = await sign(this.secret, canonicalDownloadRequest(input.path, input.organization_id, input.workspace_id, input.artifact_id, input.expires));
    return timingSafeEqual(expected, input.signature);
  }
}

function canonicalDownloadRequest(path: string, organizationId: string, workspaceId: string, artifactId: string, expires: string): string {
  return [path, organizationId, workspaceId, artifactId, expires].join('\n');
}

async function sign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function base64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
