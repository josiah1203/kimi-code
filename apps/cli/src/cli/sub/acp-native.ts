/**
 * Native `spyderbyte acp` implementation.
 *
 * Starts the local, accountless Agent Client Protocol (ACP) server backed by
 * SpiderByte Agent Core over stdio. ACP clients configure a local or BYOK
 * provider before creating a session; hosted authentication is not advertised
 * by the Open Core server.
 */

import type { Command } from 'commander';

import { getVersion } from '#/cli/version';
import { getDataDir } from '#/utils/paths';

export function registerNativeAcpCommand(parent: Command): void {
  parent
    .command('acp')
    .description('Run SpiderByte as an Agent Client Protocol (ACP) server over stdio.')
    .action(async () => {
      try {
        const { runAcpServer } = await import('@spiderbyte/acp-server');
        await runAcpServer({
          homeDir: getDataDir(),
          agentInfo: { name: 'SpiderByte', version: getVersion() },
        });
        process.exit(0);
      } catch (error) {
        process.stderr.write(`acp server: fatal error: ${String(error)}\n`);
        process.exit(1);
      }
    });
}
