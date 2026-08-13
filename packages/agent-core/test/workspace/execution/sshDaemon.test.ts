import { describe, expect, it } from 'vitest';

import { buildSshExecCommand } from '@spiderbyte/kaos/ssh';

import {
  SSH_DAEMON_COMMAND,
  assertSshPayloadSafe,
  buildSshDaemonEnvironment,
  confineSshPath,
  sshDaemonVersionCompatibility,
  validateSshTargetConfiguration,
  verifySshHostFingerprint,
} from '#/workspace/execution/sshDaemon';
import type { ExecutionTarget } from '@spiderbyte/protocol';

const sshConfig = {
  host: 'runner.example.test',
  port: 22,
  user: 'spiderbyte',
  host_key_hash: 'sha256' as const,
  host_key_fingerprint: 'a'.repeat(64),
  remote_root: '/srv/spiderbyte/workspaces/demo',
};

describe('SSH daemon transport security boundary', () => {
  it('confines relative and absolute paths to the configured remote root', () => {
    expect(confineSshPath(sshConfig.remote_root, 'datasets/input.csv'))
      .toBe('/srv/spiderbyte/workspaces/demo/datasets/input.csv');
    expect(() => confineSshPath(sshConfig.remote_root, '../other-workspace/run.json')).toThrow(/escapes/);
    expect(() => confineSshPath(sshConfig.remote_root, '/etc/passwd')).toThrow(/escapes/);
  });

  it('rejects cross-workspace and path-traversal payloads before SSH dispatch', () => {
    expect(() => assertSshPayloadSafe({ workspace_id: 'other-workspace' }, 'workspace-a', sshConfig.remote_root))
      .toThrow(/workspace/);
    expect(() => assertSshPayloadSafe({ output_path: '../../secrets.txt' }, 'workspace-a', sshConfig.remote_root))
      .toThrow(/escapes/);
  });

  it('fails closed on a host-key mismatch', () => {
    expect(verifySshHostFingerprint('b'.repeat(64), 'a'.repeat(64), 'sha256')).toBe(false);
    expect(verifySshHostFingerprint('a'.repeat(63), 'a'.repeat(64), 'sha256')).toBe(false);
    expect(verifySshHostFingerprint('a'.repeat(64), 'a'.repeat(64), 'sha256')).toBe(true);
  });

  it('only propagates the two bounded daemon environment variables', () => {
    expect(buildSshDaemonEnvironment('workspace-a')).toEqual({
      SPIDERBYTE_PROTOCOL_VERSION: '1',
      SPIDERBYTE_WORKSPACE_ID: 'workspace-a',
    });
    expect(Object.keys(buildSshDaemonEnvironment('workspace-a'))).not.toContain('SSH_AUTH_SOCK');
    expect(JSON.stringify(buildSshDaemonEnvironment('workspace-a'))).not.toContain('private-key');
  });

  it('quotes untrusted argument-shaped values and never accepts a shell command as the daemon operation', () => {
    const command = buildSshExecCommand(
      ['spyderbyte', 'daemon', 'platform-worker', '--stdio', '$(touch /tmp/should-not-run)'],
      sshConfig.remote_root,
      { SPIDERBYTE_WORKSPACE_ID: 'workspace-a; touch /tmp/should-not-run' },
    );
    expect(command).toContain("'$(touch /tmp/should-not-run)'");
    expect(command).toContain("'workspace-a; touch /tmp/should-not-run'");
    expect(SSH_DAEMON_COMMAND).toEqual(['spyderbyte', 'daemon', 'platform-worker', '--stdio']);
    expect(SSH_DAEMON_COMMAND).not.toContain('sh');
  });

  it('rejects private-key material in the typed SSH configuration', () => {
    expect(() => validateSshTargetConfiguration({
      endpoint: 'ssh://runner.example.test',
      ssh: { ...sshConfig, private_key: 'DO_NOT_STORE_THIS' },
      authenticationMethod: 'ssh_agent',
    })).toThrow(/invalid/);
  });

  it('requires explicit authentication, a confined root, and matching endpoint details', () => {
    expect(() => validateSshTargetConfiguration({
      endpoint: 'ssh://runner.example.test',
      ssh: { ...sshConfig, remote_root: '/' },
      authenticationMethod: 'ssh_agent',
    })).toThrow(/filesystem root/);
    expect(() => validateSshTargetConfiguration({
      endpoint: 'ssh://runner.example.test:2222',
      ssh: sshConfig,
      authenticationMethod: 'ssh_agent',
    })).toThrow(/port/);
    expect(() => validateSshTargetConfiguration({
      endpoint: 'ssh://runner.example.test',
      ssh: sshConfig,
      authenticationMethod: 'ssh_key',
    })).toThrow(/credential_ref/);
    expect(() => validateSshTargetConfiguration({
      endpoint: 'ssh://runner.example.test',
      ssh: sshConfig,
      authenticationMethod: 'ssh_agent',
      credentialRef: 'secret_private_key',
    })).toThrow(/private-key/);
  });

  it('reports stale or incompatible daemon protocol versions', () => {
    const target = {
      version_compatibility: { required_protocol_version: 1 },
    } as ExecutionTarget;
    expect(sshDaemonVersionCompatibility(target, 1)).toMatchObject({ compatible: true });
    expect(sshDaemonVersionCompatibility(target, 2)).toMatchObject({
      compatible: false,
      message: 'expected protocol version 1',
    });
  });
});
