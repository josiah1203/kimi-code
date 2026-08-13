/** Customer-owned SpiderByte daemon entrypoints. */

import { runSshDaemonStdio } from '@spiderbyte/agent-core';
import type { Command } from 'commander';

export function registerDaemonCommand(parent: Command): void {
  const daemon = parent
    .command('daemon')
    .description('Run a customer-owned SpiderByte daemon component.');
  daemon
    .command('platform-worker')
    .description('Serve the governed semantic execution protocol over stdio.')
    .requiredOption('--stdio', 'Use the versioned one-request JSON stdio protocol.')
    .action(async () => {
      try {
        await runSshDaemonStdio();
      } catch (error) {
        process.stderr.write(`daemon: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });
}
