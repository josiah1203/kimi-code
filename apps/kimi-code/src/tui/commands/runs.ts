import type { Artifact, Run, Session } from '@moonshot-ai/kimi-code-sdk';

import type { SlashCommandHost } from './dispatch';

/** Show the durable platform Runs without introducing a second transcript. */
export async function handleRunsCommand(host: SlashCommandHost, args = ''): Promise<void> {
  const session = await sessionForRuns(host);
  if (session === undefined) return;
  const runs = host.harness.getPlatformSessionRuns(session.id);
  if (runs === undefined) {
    host.showError(
      'Platform Runs are unavailable. Inspect startup diagnostics; the default SpiderByte harness must not silently fall back.',
    );
    return;
  }

  try {
    const requestedId = args.trim();
    if (requestedId.length > 0) {
      const run = await runs.get(requestedId);
      if (run === undefined) {
        host.showError(`Platform Run not found: ${requestedId}`);
        return;
      }
      host.showNotice(`Platform Run ${run.id}`, await formatRunDetails(host, run));
      return;
    }
    const values = (await runs.list())
      .toSorted((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, 20);
    if (values.length === 0) {
      host.showStatus('No platform Runs are recorded for this session.');
      return;
    }
    host.showNotice(
      'Platform Runs',
      values.map(formatRun).join('\n'),
    );
  } catch (error) {
    host.showError(`Failed to inspect platform Runs: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function formatRunDetails(host: SlashCommandHost, run: Run): Promise<string> {
  const lines = [formatRun(run)];
  const refs = run.output_artifacts ?? [];
  if (refs.length === 0) return lines.join('\n');

  lines.push('', 'Artifacts:');
  const platform = host.harness.platform;
  const workspaceId = platform?.workspaceIdForRoot === undefined
    ? undefined
    : await platform.workspaceIdForRoot(host.state.appState.workDir);
  if (platform === undefined || workspaceId === undefined) {
    lines.push(...refs.map((ref) => `- ${ref.id} · v${ref.version}`));
    return lines.join('\n');
  }

  for (const ref of refs.slice(0, 20)) {
    const artifact = await platform.artifacts.get(workspaceId, ref.id);
    if (artifact === undefined) {
      lines.push(`- ${ref.id} · v${ref.version} · unavailable`);
      continue;
    }
    lines.push(formatArtifact(artifact, ref.version));
    const lineage = await platform.artifacts.lineage(workspaceId, artifact.id);
    if (lineage === undefined) continue;
    const upstream = lineage.upstream_artifacts.map((item) => item.id);
    const downstream = lineage.downstream_artifacts.map((item) => item.id);
    if (upstream.length > 0) lines.push(`  upstream: ${upstream.join(', ')}`);
    if (downstream.length > 0) lines.push(`  downstream: ${downstream.join(', ')}`);
  }
  if (refs.length > 20) lines.push(`- … ${refs.length - 20} more artifacts`);
  return lines.join('\n');
}

function formatArtifact(artifact: Artifact, version: number): string {
  const size = artifact.size_bytes === undefined ? '' : ` · ${artifact.size_bytes} bytes`;
  const hash = artifact.sha256 === undefined ? '' : ` · sha256:${artifact.sha256.slice(0, 12)}`;
  return `- ${artifact.name} · ${artifact.kind} · ${artifact.id} · v${version}${size}${hash}`;
}

async function sessionForRuns(host: SlashCommandHost): Promise<Session | undefined> {
  if (host.session !== undefined) return host.session;
  return host.ensureSession();
}

function formatRun(run: {
  readonly id: string;
  readonly status: string;
  readonly updated_at: string;
  readonly status_reason?: string;
  readonly output_artifacts?: readonly { readonly id: string }[];
}): string {
  const artifactCount = run.output_artifacts?.length ?? 0;
  const artifacts = artifactCount === 0 ? '' : ` · ${artifactCount} artifact${artifactCount === 1 ? '' : 's'}`;
  const reason = run.status_reason === undefined ? '' : ` · ${run.status_reason.slice(0, 160)}`;
  return `${run.id} · ${run.status}${artifacts} · ${run.updated_at}${reason}`;
}
