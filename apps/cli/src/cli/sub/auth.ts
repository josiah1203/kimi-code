/** Local accountless authentication commands.
 *
 * Open Core never contacts a hosted identity authority. Provider credentials
 * are configured locally through `spyderbyte provider` or config.toml.
 */

import type { Command } from 'commander';

interface AuthCommandOptions {
  readonly json?: boolean;
}

export function registerAuthCommands(parent: Command): void {
  const auth = parent.command('auth').description('Inspect local accountless authentication.');

  auth
    .command('status')
    .option('--json', 'Print machine-readable JSON.')
    .action((options: AuthCommandOptions) => {
      const status = {
        mode: 'local',
        authenticated: false,
        account_token: false,
        hosted_identity: 'excluded',
      } as const;
      process.stdout.write(`${options.json === true ? JSON.stringify(status) : 'Open Core local mode; no hosted account is configured.'}\n`);
    });
}
