import { visibleWidth } from '@spiderbyte/pi-tui';
import { afterEach, describe, expect, it } from 'vitest';

import { buildUsageReportLines, UsagePanelComponent } from '#/tui/components/messages/usage-panel';
import { currentTheme, darkColors, lightColors } from '#/tui/theme';

afterEach(() => {
  currentTheme.setPalette(darkColors);
});

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('UsagePanelComponent', () => {
  it('formats local session and context usage sections', () => {
    const lines = buildUsageReportLines({
      sessionUsage: {
        byModel: {
          'local/model': {
            inputOther: 1000,
            inputCacheRead: 500,
            inputCacheCreation: 500,
            output: 250,
          },
        },
      },
      contextUsage: 0.25,
      contextTokens: 2500,
      maxContextTokens: 10000,
    }).map(strip);

    expect(lines).toContain('Session usage');
    expect(lines).toContain('  local/model  input 2k  output 250  total 2.2k');
    expect(lines).toContain('Context window');
    expect(lines.join('\n')).toContain('25%');
    expect(lines.join('\n')).not.toContain('Plan usage');
    expect(lines.join('\n')).not.toContain('Extra Usage');
  });

  it('wraps preformatted usage lines in a bordered panel', () => {
    const component = new UsagePanelComponent(() => ['Session usage'], 'primary');
    const output = component.render(80).map(strip);

    expect(output[0]).toContain(' Usage ');
    expect(output[1]).toContain('Session usage');
  });

  it('truncates lines wider than the terminal so the panel never overflows', () => {
    const component = new UsagePanelComponent(() => [`error: ${'x'.repeat(200)}`], 'primary');
    const output = component.render(60);

    for (const line of output) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(60);
    }
  });

  it('keeps the bordered panel within narrow terminal widths', () => {
    const component = new UsagePanelComponent(() => ['Session usage', '  local/model  input 2.0k'], 'primary');

    for (const width of [39, 24, 20, 10, 4, 1]) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('rebuilds its body from the active palette on invalidate', () => {
    const component = new UsagePanelComponent(() => [`text=${currentTheme.color('text')}`], 'primary');
    const bodyOf = (): string => {
      const line = component.render(80).map(strip).find((value) => value.includes('text='));
      if (line === undefined) throw new Error('body line not found');
      return line;
    };

    expect(bodyOf()).toContain(darkColors.text);
    currentTheme.setPalette(lightColors);
    component.invalidate();
    expect(bodyOf()).toContain(lightColors.text);
  });
});
