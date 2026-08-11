import * as vscode from "vscode";

import { Events } from "../shared/bridge";
import { SpiderByteWebviewProvider } from "./SpiderByteWebviewProvider";
import { onSettingsChange, VSCodeSettings } from "./config/vscode-settings";

let outputChannel: vscode.OutputChannel | undefined;
let provider: SpiderByteWebviewProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel("SpiderByte");
  const remoteInfo = vscode.env.remoteName ? ` (remote: ${vscode.env.remoteName})` : "";
  log(`SpiderByte ${VSCodeSettings.getExtensionConfig().version} activating${remoteInfo}`);

  provider = new SpiderByteWebviewProvider(
    context.extensionUri,
    context,
    () => outputChannel?.show(),
    (message) => log(message),
  );
  context.subscriptions.push(provider, outputChannel);

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("spiderbyte-baseline", {
      provideTextDocumentContent: async (uri) => {
        const sessionId = new URLSearchParams(uri.query).get("sessionId");
        if (!sessionId || !provider) return "";
        const relativePath = decodeURIComponent(uri.path.replace(/^\//, ""));
        try {
          return await provider.getBaselineContent(sessionId, relativePath);
        } catch (error) {
          logError("Unable to open baseline content", error);
          return "";
        }
      },
    }),
  );

  context.subscriptions.push(
    onSettingsChange((changedKeys) => {
      provider?.broadcast(Events.ExtensionConfigChanged, {
        config: VSCodeSettings.getExtensionConfig(),
        changedKeys,
      });
      if (changedKeys.includes("yoloMode")) {
        void provider
          ?.setYoloModeForActiveSessions(VSCodeSettings.yoloMode)
          .catch((error) => logError("Unable to update session permission", error));
      }
    }),
    vscode.window.registerWebviewViewProvider("spiderbyte.webview", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const commands: Record<string, () => void | Promise<void>> = {
    "spiderbyte.clearAllState": async () => {
      await context.globalState.update("spiderbyte.config", undefined);
      await context.globalState.update("spiderbyte.mcpServers", undefined);
      await context.workspaceState.update("spiderbyte.mcpEnabled", undefined);
      await vscode.window.showInformationMessage("SpiderByte: Extension UI state cleared.");
    },
    "spiderbyte.openInTab": () => {
      provider?.createPanel();
    },
    "spiderbyte.openInSideBar": async () => {
      await vscode.commands.executeCommand("spiderbyte.webview.focus");
    },
    "spiderbyte.focusInput": async () => {
      await vscode.commands.executeCommand("spiderbyte.webview.focus");
      provider?.broadcast(Events.FocusInput, {});
    },
    "spiderbyte.insertMention": async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        await vscode.window.showWarningMessage("No active editor");
        return;
      }
      await vscode.commands.executeCommand("spiderbyte.webview.focus");
      if (!(await provider?.insertEditorMention(editor.document.uri, editor.selection))) {
        await vscode.window.showWarningMessage("The active file is outside the selected working directory.");
      }
    },
    "spiderbyte.newConversation": async () => {
      await vscode.commands.executeCommand("spiderbyte.webview.focus");
      provider?.broadcast(Events.NewConversation, {});
    },
    "spiderbyte.showLogs": () => outputChannel?.show(),
    "spiderbyte.resetSpiderByte": () => provider?.resetAllWebviews(),
  };

  for (const [id, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }

  log("SpiderByte activated");
}

export async function deactivate(): Promise<void> {
  log("SpiderByte deactivating");
  await provider?.shutdown();
  provider = undefined;
}

function log(message: string): void {
  outputChannel?.appendLine(`[${new Date().toISOString()}] ${message}`);
}

function logError(message: string, error: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  log(`${message}: ${detail}`);
}

export { log };
