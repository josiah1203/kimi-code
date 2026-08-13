/** Canonical local MCP server command for Codex and other stdio clients. */

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import {
  createSpyderbyteMcpServer,
  resolveSpyderbyteMcpProfile,
  startServer,
  type SpyderbyteMcpProfile,
} from '@spiderbyte/kap-server';
import { resolveSpiderByteHome } from '@spiderbyte/agent-core';
import type { Command } from 'commander';

import { createSpiderByteHostIdentity, getVersion } from '#/cli/version';
import { getDataDir } from '#/utils/paths';

export interface McpCliOptions {
  readonly workspace?: string;
  readonly profile?: SpyderbyteMcpProfile;
}

export function registerMcpCommand(parent: Command): void {
  parent
    .command('mcp')
    .description('Run the local SpiderByte MCP server over stdio for Codex or another MCP client.')
    .option(
      '--workspace <workspace-id>',
      'Default local workspace for workspace-scoped tools; omit to require workspace_id in each call.',
    )
    .option('--profile <profile>', 'MCP tool profile: full (developer) or curated (Otis plugin).', 'full')
    .action(async (options: McpCliOptions) => {
      try {
        await runMcpStdio(options);
      } catch (error) {
        process.stderr.write(`mcp server: fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });
}

export async function runMcpStdio(options: McpCliOptions = {}): Promise<void> {
  const version = getVersion();
  const running = await startServer({
    host: '127.0.0.1',
    port: 0,
    listen: false,
    homeDir: resolveSpiderByteHome(getDataDir()),
    disableAuth: true,
    logLevel: 'silent',
    hostIdentity: {
      ...createSpiderByteHostIdentity(version),
      displayName: 'SpiderByte MCP',
    },
  });
  const handle = serveStdio(
    () => createSpyderbyteMcpServer({
      core: running.core,
      mode: 'local-stdio',
      defaultWorkspaceId: options.workspace ?? process.env['SPIDERBYTE_MCP_WORKSPACE_ID'],
      profile: resolveSpyderbyteMcpProfile(options.profile),
      actorId: process.env['SPIDERBYTE_LOCAL_ACTOR_ID'],
      clientName: 'stdio',
    }),
    {
      // Keep the CLI usable with existing 2025 clients while modern clients
      // negotiate 2026-07-28 per the v2 stdio serving entry.
      legacy: 'serve',
      onerror: (error) => {
        process.stderr.write(`mcp server: ${error.message}\n`);
      },
    },
  );
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await handle.close().catch(() => undefined);
    await running.close();
  };

  try {
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        void stop().finally(resolve);
      };
      process.once('SIGINT', finish);
      process.once('SIGTERM', finish);
      process.stdin.once('end', finish);
    });
  } finally {
    await stop();
  }
}
