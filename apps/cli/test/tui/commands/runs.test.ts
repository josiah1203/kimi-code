import { describe, expect, it, vi } from 'vitest';

import { handleRunsCommand } from '#/tui/commands/runs';
import type { SlashCommandHost } from '#/tui/commands/dispatch';
import type { Artifact, Run, Session } from '@spiderbyte/sdk';

function makeRun(): Run {
  return {
    id: 'run_analysis_01',
    workspace_id: 'workspace_test',
    agent_session_id: 'session_test',
    status: 'succeeded',
    created_at: '2026-08-09T00:00:00.000Z',
    updated_at: '2026-08-09T00:00:02.000Z',
    output_artifacts: [{ id: 'artifact_report', version: 1 }],
  };
}

function makeArtifact(): Artifact {
  return {
    id: 'artifact_report',
    workspace_id: 'workspace_test',
    run_id: 'run_analysis_01',
    name: 'analysis-report.json',
    kind: 'metrics',
    version: 1,
    content_ref: 'blob_hash',
    size_bytes: 128,
    sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    created_at: '2026-08-09T00:00:02.000Z',
    source_artifact_ids: ['artifact_dataset'],
  };
}

function makeHost(run: Run): SlashCommandHost & { readonly notice: ReturnType<typeof vi.fn> } {
  const notice = vi.fn();
  const artifact = makeArtifact();
  return {
    session: { id: 'session_test' } as Session,
    state: { appState: { workDir: '/workspace/project' } } as SlashCommandHost['state'],
    harness: {
      getPlatformSessionRuns: vi.fn(() => ({
        list: vi.fn(async () => [run]),
        get: vi.fn(async () => run),
      })),
      platform: {
        workspaceIdForRoot: vi.fn(async () => 'workspace_test'),
        artifacts: {
          get: vi.fn(async () => artifact),
          lineage: vi.fn(async () => ({
            artifact,
            upstream_artifacts: [{ ...artifact, id: 'artifact_dataset', name: 'sales.csv' }],
            downstream_artifacts: [],
            downstream_run_ids: [],
          })),
        },
      },
    } as unknown as SlashCommandHost['harness'],
    notice,
    showNotice: notice,
    showError: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost & { readonly notice: ReturnType<typeof vi.fn> };
}

describe('handleRunsCommand', () => {
  it('shows persisted artifact metadata and lineage for a selected Run', async () => {
    const host = makeHost(makeRun());

    await handleRunsCommand(host, 'run_analysis_01');

    expect(host.notice).toHaveBeenCalledWith(
      'Platform Run run_analysis_01',
      expect.stringContaining('analysis-report.json · metrics · artifact_report · v1 · 128 bytes'),
    );
    expect(host.notice.mock.calls[0]?.[1]).toContain('upstream: artifact_dataset');
    expect(host.showError).not.toHaveBeenCalled();
  });
});
