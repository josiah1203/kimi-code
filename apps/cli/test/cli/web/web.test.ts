import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';

import { registerWebCommand } from '#/cli/sub/web';

describe('spyderbyte web', () => {
  it('registers the foreground web command and rotate-token subcommand', () => {
    const program = new Command('spyderbyte').exitOverride();
    registerWebCommand(program);

    const web = program.commands.find((command) => command.name() === 'web');
    expect(web).toBeDefined();
    expect(web?.commands.map((command) => command.name())).toEqual(['rotate-token']);
    expect(web?.options.map((option) => option.long)).toContain('--port');
    expect(web?.options.map((option) => option.long)).toContain('--host');
    expect(web?.options.map((option) => option.long)).not.toContain('--daemon');
    expect(web?.options.map((option) => option.long)).not.toContain('--keep-alive');
  });

  it('does not expose a retired server or kill command', () => {
    const program = new Command('spyderbyte').exitOverride();
    registerWebCommand(program);

    expect(program.commands.some((command) => command.name() === 'server')).toBe(false);
    expect(program.commands.some((command) => command.name() === 'web' && command.commands.some((sub) => sub.name() === 'kill'))).toBe(false);
  });

  it('keeps registration free of process-exit side effects', () => {
    const exit = vi.spyOn(process, 'exit');
    const program = new Command('spyderbyte').exitOverride();
    registerWebCommand(program);
    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });
});
