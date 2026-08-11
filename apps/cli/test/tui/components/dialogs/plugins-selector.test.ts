import { describe, expect, it, vi } from 'vitest';

import type { PluginSummary } from '@spiderbyte/sdk';

import {
  PluginMcpSelectorComponent,
  PluginsPanelComponent,
  type PluginsPanelSelection,
} from '#/tui/components/dialogs/plugins-selector';

const plugin: PluginSummary = {
  id: 'example-plugin',
  displayName: 'Example plugin',
  version: '1.0.0',
  enabled: true,
  state: 'ok',
  skillCount: 0,
  mcpServerCount: 0,
  enabledMcpServerCount: 0,
  hookCount: 0,
  commandCount: 0,
  hasErrors: false,
  source: 'local-path',
};

function makePanel(initialTab: 'installed' | 'official' | 'third-party' | 'custom' = 'installed') {
  const selections: PluginsPanelSelection[] = [];
  const panel = new PluginsPanelComponent({
    installed: [plugin],
    installedIds: new Set([plugin.id]),
    initialTab,
    onSelect: (selection) => selections.push(selection),
    onCancel: vi.fn(),
    onRequestMarketplace: vi.fn(),
  });
  return { panel, selections };
}

describe('plugins selector dialogs', () => {
  it('reports installed plugins and routes Enter to details', () => {
    const { panel, selections } = makePanel();
    expect(panel.render(100).join('\n')).toContain('Example plugin');

    panel.handleInput('\r');
    expect(selections).toEqual([{ kind: 'details', id: 'example-plugin' }]);
  });

  it('routes Space to toggle an installed plugin', () => {
    const { panel, selections } = makePanel();
    panel.handleInput(' ');
    expect(selections).toEqual([{ kind: 'toggle', id: 'example-plugin', enabled: false }]);
  });

  it('renders a loaded marketplace entry as a normal install', () => {
    const { panel, selections } = makePanel('official');
    panel.setMarketplace(
      [{ id: 'local-plugin', displayName: 'Local plugin', source: '/tmp/local-plugin', tier: 'official' }],
      '/tmp/marketplace.json',
    );
    expect(panel.render(100).join('\n')).toContain('Local plugin');

    panel.handleInput('\r');
    expect(selections).toEqual([
      {
        kind: 'install',
        entry: { id: 'local-plugin', displayName: 'Local plugin', source: '/tmp/local-plugin', tier: 'official' },
      },
    ]);
  });

  it('keeps custom installation as an explicit source action', () => {
    const { panel, selections } = makePanel('custom');
    panel.handleInput('https://example.test/plugin.zip');
    expect(selections).toEqual([]);
    panel.handleInput('\r');
    expect(selections).toEqual([
      { kind: 'install-source', source: 'https://example.test/plugin.zip' },
    ]);
  });

  it('lists MCP servers and emits a toggle action', () => {
    const selections: Array<{ kind: string; enabled?: boolean }> = [];
    const panel = new PluginMcpSelectorComponent({
      info: {
        id: 'example-plugin',
        displayName: 'Example plugin',
        root: '/tmp/example-plugin',
        installedAt: '2026-08-10T00:00:00.000Z',
        version: '1.0.0',
        enabled: true,
        state: 'ok',
        skillCount: 0,
        mcpServerCount: 1,
        enabledMcpServerCount: 1,
        hookCount: 0,
        commandCount: 0,
        hasErrors: false,
        diagnostics: [],
        source: 'local-path',
        mcpServers: [
          {
            name: 'local',
            enabled: true,
            transport: 'stdio',
            runtimeName: 'local',
          },
        ],
      },
      onSelect: (selection) => selections.push(selection as { kind: string; enabled?: boolean }),
      onCancel: vi.fn(),
    });
    panel.handleInput('\r');
    expect(selections).toContainEqual({ kind: 'toggle', enabled: false, pluginId: 'example-plugin', server: 'local' });
  });
});
