import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function initLog(context: vscode.ExtensionContext): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Linear Markdown Sync");
    context.subscriptions.push(channel);
  }
  return channel;
}

function stamp(): string {
  // Time-only, host-local; avoids leaking full paths into user-visible logs.
  return new Date().toLocaleTimeString();
}

export function log(message: string): void {
  channel?.appendLine(`[${stamp()}] ${message}`);
}

export function logError(message: string, err?: unknown): void {
  const detail = err instanceof Error ? err.stack ?? err.message : err ? String(err) : "";
  channel?.appendLine(`[${stamp()}] ERROR: ${message}${detail ? `\n${detail}` : ""}`);
}
