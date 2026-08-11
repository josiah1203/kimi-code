import type { McpServerInfo, SessionStatus, SessionUsage } from '@spiderbyte/sdk';

import { buildMcpStatusReportLines } from '../components/messages/mcp-status-panel';
import { buildStatusReportLines } from '../components/messages/status-panel';
import { buildUsageReportLines, UsagePanelComponent } from '../components/messages/usage-panel';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';

// ---------------------------------------------------------------------------
// Info commands
// ---------------------------------------------------------------------------

interface SessionUsageResult {
  readonly usage?: SessionUsage;
  readonly error?: string;
}

interface RuntimeStatusResult {
  readonly status?: SessionStatus;
  readonly error?: string;
}

interface PlatformUsageSummary {
  readonly workspace_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly intelligence_percent: number;
  readonly model_units: number;
  readonly execution_seconds: number;
  readonly artifact_storage_units: number;
  readonly plugin_usage_units: number;
  readonly record_count: number;
}

interface PlatformUsageResult {
  readonly summary?: PlatformUsageSummary;
  readonly error?: string;
}

export async function showUsage(host: SlashCommandHost): Promise<void> {
  const sessionUsage = await loadSessionUsageReport(host);
  const platformUsage = await loadPlatformUsageReport(host);
  if (platformUsage.error !== undefined) {
    host.showStatus(`SpiderByte platform usage unavailable: ${platformUsage.error}`);
  } else if (platformUsage.summary !== undefined) {
    const summary = platformUsage.summary;
    host.showNotice(
      'SpiderByte usage',
      [
        `workspace: ${summary.workspace_id}`,
        `period: ${summary.period_start} → ${summary.period_end}`,
        `intelligence: ${String(summary.intelligence_percent)}`,
        `model units: ${String(summary.model_units)}`,
        `execution seconds: ${String(summary.execution_seconds)}`,
        `artifact/storage units: ${String(summary.artifact_storage_units)}`,
        `plugin/integration units: ${String(summary.plugin_usage_units)}`,
        `records: ${String(summary.record_count)}`,
      ].join('\n'),
    );
  }
  const reportArgs = {
    sessionUsage: sessionUsage.usage,
    sessionUsageError: sessionUsage.error,
    contextUsage: host.state.appState.contextUsage,
    contextTokens: host.state.appState.contextTokens,
    maxContextTokens: host.state.appState.maxContextTokens,
  };
  const panel = new UsagePanelComponent(() => buildUsageReportLines(reportArgs), 'primary');
  host.state.transcriptContainer.addChild(panel);
  host.state.ui.requestRender();
}

export async function showStatusReport(host: SlashCommandHost): Promise<void> {
  const runtimeStatus = await loadRuntimeStatusReport(host);
  const appState = host.state.appState;
  const reportArgs = {
    version: appState.version,
    model: appState.model,
    workDir: appState.workDir,
    sessionId: appState.sessionId,
    sessionTitle: appState.sessionTitle,
    thinkingEffort: appState.thinkingEffort,
    permissionMode: appState.permissionMode,
    planMode: appState.planMode,
    contextUsage: appState.contextUsage,
    contextTokens: appState.contextTokens,
    maxContextTokens: appState.maxContextTokens,
    availableModels: appState.availableModels,
    status: runtimeStatus.status,
    statusError: runtimeStatus.error,
  };
  const panel = new UsagePanelComponent(() => buildStatusReportLines(reportArgs), 'primary', ' Status ');
  host.state.transcriptContainer.addChild(panel);
  host.state.ui.requestRender();
}

export async function showMcpServers(host: SlashCommandHost): Promise<void> {
  let servers: readonly McpServerInfo[];
  try {
    if (host.session !== undefined) {
      servers = await host.session.listMcpServers();
    } else {
      // The MCP connection set is workspace-scoped, so it is
      // inspectable before the first session exists.
      servers = await host.harness.listWorkspaceMcpServers(host.state.appState.workDir);
    }
  } catch (error) {
    host.showError(`Failed to load MCP servers: ${formatErrorMessage(error)}`);
    return;
  }

  const title = servers.length > 0 ? ` MCP (${servers.length}) ` : ' MCP ';
  const panel = new UsagePanelComponent(
    () => buildMcpStatusReportLines({ servers }),
    'primary',
    title,
  );
  host.state.transcriptContainer.addChild(panel);
  host.state.ui.requestRender();
}

async function loadSessionUsageReport(host: SlashCommandHost): Promise<SessionUsageResult> {
  try {
    return { usage: await host.requireSession().getUsage() };
  } catch (error) {
    return { error: formatErrorMessage(error) };
  }
}

async function loadRuntimeStatusReport(host: SlashCommandHost): Promise<RuntimeStatusResult> {
  try {
    return { status: await host.requireSession().getStatus() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function loadPlatformUsageReport(host: SlashCommandHost): Promise<PlatformUsageResult> {
  const platform = host.harness.platform;
  if (platform?.workspaceIdForRoot === undefined) {
    return { error: 'canonical platform services are unavailable' };
  }
  try {
    const workspaceId = await platform.workspaceIdForRoot(host.state.appState.workDir);
    if (workspaceId === undefined) {
      return { error: 'current directory is not a registered workspace' };
    }
    return { summary: await platform.usage.usageSummary(workspaceId) };
  } catch (error) {
    return { error: formatErrorMessage(error) };
  }
}
