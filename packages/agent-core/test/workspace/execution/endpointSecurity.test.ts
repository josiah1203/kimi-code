import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { lookup } from 'node:dns/promises';

import {
  isLoopbackOrLinkLocalHost,
  isPrivateNetworkHost,
  resolveExecutionEndpoint,
} from '#/workspace/execution/endpointSecurity';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

const lookupMock = lookup as unknown as Mock;

describe('execution endpoint security', () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it('rejects localhost aliases before DNS resolution', async () => {
    await expect(resolveExecutionEndpoint('https://localhost./execute', 'customer-managed'))
      .rejects.toThrow('private address');
    expect(lookupMock).not.toHaveBeenCalled();
    expect(isPrivateNetworkHost('localhost')).toBe(true);
    expect(isLoopbackOrLinkLocalHost('service.localhost')).toBe(true);
  });

  it('rejects a public hostname that resolves to a private address', async () => {
    lookupMock.mockResolvedValue([{ address: '10.20.0.5', family: 4 }]);

    await expect(resolveExecutionEndpoint('https://worker.example/execute', 'customer-managed'))
      .rejects.toThrow('resolves to a private address');
    expect(lookupMock).toHaveBeenCalledWith('worker.example', { all: true });
  });

  it('pins approved public DNS answers for customer-managed workers', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2001:db8::10', family: 6 },
    ]);

    const resolved = await resolveExecutionEndpoint('https://worker.example/execute', 'customer-managed');
    expect(resolved.url).toBe('https://worker.example/execute');
    expect(resolved.dispatcher).toBeDefined();
    await resolved.dispatcher?.close();
  });

  it('allows customer-private DNS answers only for a private gateway', async () => {
    lookupMock.mockResolvedValue([{ address: '10.20.0.5', family: 4 }]);
    const resolved = await resolveExecutionEndpoint('https://gateway.example/execute', 'private-gateway');
    expect(resolved.dispatcher).toBeDefined();
    await resolved.dispatcher?.close();

    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(resolveExecutionEndpoint('https://gateway.example/execute', 'private-gateway'))
      .rejects.toThrow('loopback or link-local');
  });

  it('fails closed when a worker hostname cannot be resolved', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND worker.example'));

    await expect(resolveExecutionEndpoint('https://worker.example/execute', 'customer-managed'))
      .rejects.toThrow('could not be resolved');
  });
});
