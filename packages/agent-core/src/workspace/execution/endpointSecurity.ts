/**
 * `execution` domain — shared worker endpoint host classification.
 *
 * Keeps target registration, health probing, and worker dispatch aligned: a
 * normal customer-managed worker is public-network only, while an explicitly
 * configured private gateway may use customer-private ranges but never
 * loopback or link-local destinations.
 */

import { type LookupAddress, type LookupOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';

import { Agent, type Dispatcher } from 'undici';

export type RemoteExecutionTargetType = 'customer-managed' | 'private-gateway';

export class ExecutionEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutionEndpointError';
  }
}

export interface ResolvedExecutionEndpoint {
  readonly url: string;
  readonly dispatcher?: Dispatcher;
}

/**
 * Resolve and validate a remote endpoint before any health or execution call.
 * Hostnames are resolved once and the resulting addresses are pinned into
 * the HTTP dispatcher so a later DNS answer cannot redirect the request to a
 * different network location.
 */
export async function resolveExecutionEndpoint(
  value: string,
  targetType: RemoteExecutionTargetType,
): Promise<ResolvedExecutionEndpoint> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ExecutionEndpointError('execution target endpoint is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ExecutionEndpointError('execution target endpoint must use http or https');
  }
  if (url.username !== '' || url.password !== '') {
    throw new ExecutionEndpointError('execution target endpoint must not contain embedded credentials');
  }
  for (const key of url.searchParams.keys()) {
    if (/(?:token|secret|password|api[_-]?key|authorization|credential)/i.test(key)) {
      throw new ExecutionEndpointError('execution target endpoint must not contain credential query parameters');
    }
  }

  const host = normalizeHost(url.hostname);
  if (host.length === 0) throw new ExecutionEndpointError('execution target endpoint has no hostname');
  if (isIP(host) !== 0) {
    assertResolvedAddressAllowed(host, targetType);
    return { url: url.toString() };
  }
  if (targetType !== 'private-gateway' && isPrivateNetworkHost(host)) {
    throw new ExecutionEndpointError('execution target endpoint must not use a private address');
  }
  if (targetType === 'private-gateway' && isLoopbackOrLinkLocalHost(host)) {
    throw new ExecutionEndpointError('private-gateway endpoint must not use a loopback or link-local address');
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(host, { all: true });
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : '';
    throw new ExecutionEndpointError(`execution target endpoint hostname could not be resolved${detail}`);
  }
  if (addresses.length === 0) {
    throw new ExecutionEndpointError('execution target endpoint hostname resolved to no addresses');
  }
  for (const { address } of addresses) assertResolvedAddressAllowed(address, targetType);

  return {
    url: url.toString(),
    dispatcher: new Agent({ connect: { lookup: pinnedLookup(host, addresses) } }),
  };
}

export function isPrivateNetworkHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  const mappedIpv4 = mappedIpv4Host(host);
  if (mappedIpv4 !== undefined) return isPrivateNetworkHost(mappedIpv4);
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.includes(':')) {
    if (!/^[0-9a-f:]+$/i.test(host)) return false;
    return host === '::' || host === '::1'
      || host.startsWith('fc')
      || host.startsWith('fd')
      || /^fe[89ab]/i.test(host);
  }
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [first, second] = octets as [number, number, number, number];
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 100 && second >= 64 && second <= 127);
}

export function isLoopbackOrLinkLocalHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  const mappedIpv4 = mappedIpv4Host(host);
  if (mappedIpv4 !== undefined) return isLoopbackOrLinkLocalHost(mappedIpv4);
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::' || host === '::1') return true;
  if (host.includes(':')) return /^[0-9a-f:]+$/i.test(host) && /^fe[89ab]/i.test(host);
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [first, second] = octets as [number, number, number, number];
  return first === 0
    || first === 127
    || (first === 169 && second === 254);
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '').split('%', 1)[0] ?? '';
}

function mappedIpv4Host(hostname: string): string | undefined {
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(hostname);
  return match?.[1];
}

function assertResolvedAddressAllowed(address: string, targetType: RemoteExecutionTargetType): void {
  if (targetType !== 'private-gateway' && isPrivateNetworkHost(address)) {
    throw new ExecutionEndpointError('execution target endpoint resolves to a private address');
  }
  if (targetType === 'private-gateway' && isLoopbackOrLinkLocalHost(address)) {
    throw new ExecutionEndpointError('private-gateway endpoint resolves to a loopback or link-local address');
  }
}

function pinnedLookup(host: string, addresses: LookupAddress[]): LookupFunction {
  return (hostname: string, options: LookupOptions | undefined, callback) => {
    if (normalizeHost(hostname) !== host) {
      callback(Object.assign(new Error('pinned execution endpoint attempted to resolve another hostname'), {
        code: 'ERR_EXECUTION_ENDPOINT_HOST_MISMATCH',
      }), '', 0);
      return;
    }
    if (options?.all === true) {
      callback(null, [...addresses]);
      return;
    }
    const matching = options?.family === undefined || options.family === 0
      ? addresses[0]
      : addresses.find((entry) => entry.family === options.family);
    if (matching === undefined) {
      callback(Object.assign(new Error('no pinned address matches the requested address family'), { code: 'EAI_FAMILY' }), '', 0);
      return;
    }
    callback(null, matching.address, matching.family);
  };
}
