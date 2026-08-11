import { InvalidArgumentError, Option, type Command } from 'commander';

import type { CLIOptions, PromptOutputFormat } from '../options';

export function registerRunCommand(
  parent: Command,
  onMain: (opts: CLIOptions) => void,
): void {
  const run = parent
    .command('run')
    .description('Execute one governed SpiderByte prompt through the default harness.')
    .argument('[prompt]', 'Prompt to execute; --prompt is also accepted for scripts.')
    .option('-p, --prompt <prompt>', 'Prompt to execute.')
    .option('-m, --model <model>', 'Configured model alias.')
    .addOption(
      new Option('--output-format <format>', 'Output format.')
        .choices(['text', 'stream-json']),
    );

  run.action((argument: string | undefined, options: {
    readonly prompt?: string;
    readonly model?: string;
    readonly outputFormat?: PromptOutputFormat;
  }) => {
    const prompt = options.prompt ?? argument;
    if (prompt === undefined || prompt.trim().length === 0) {
      throw new InvalidArgumentError('a prompt is required (pass it as an argument or with --prompt)');
    }
    onMain({
      session: undefined,
      continue: false,
      yolo: false,
      auto: false,
      plan: false,
      model: options.model,
      outputFormat: options.outputFormat,
      prompt,
      skillsDirs: [],
      agent: undefined,
      agentFiles: [],
      addDirs: [],
    });
  });
}
