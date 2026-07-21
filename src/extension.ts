import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { readConfig } from "./config";
import { initLog, log, logError } from "./log";
import { createClient, parseIdentifier, verifyApiKey } from "./linear";
import {
  clearApiKey,
  ensureApiKey,
  getApiKey,
  promptAndStoreApiKey,
} from "./secrets";
import { runSync, type SyncParams, type SyncSummary } from "./sync";

let intervalTimer: ReturnType<typeof setInterval> | undefined;
let watcher: vscode.FileSystemWatcher | undefined;
let inFlight: Promise<SyncSummary | undefined> | undefined;
const pendingWatchFolders = new Set<string>();
let watchDebounce: ReturnType<typeof setTimeout> | undefined;

export function activate(context: vscode.ExtensionContext): void {
  initLog(context);
  log("Linear Markdown Sync activated.");

  context.subscriptions.push(
    vscode.commands.registerCommand("linearMarkdownSync.setApiKey", () =>
      handleSetApiKey(context)
    ),
    vscode.commands.registerCommand("linearMarkdownSync.clearApiKey", async () => {
      await clearApiKey(context);
      vscode.window.showInformationMessage("Linear API key cleared.");
    }),
    vscode.commands.registerCommand("linearMarkdownSync.syncNow", () =>
      triggerSync(context, { interactive: true, force: true })
    )
  );

  // React to configuration changes: rebuild the interval timer and watcher.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("linearMarkdownSync")) {
        setupInterval(context);
        setupWatcher(context);
      }
    })
  );

  setupInterval(context);
  setupWatcher(context);

  const config = readConfig();
  if (config.syncOnStartup) {
    // Fire and forget; failures surface in the output channel.
    void triggerSync(context, { interactive: false });
  }
}

export function deactivate(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
  }
  watcher?.dispose();
}

async function handleSetApiKey(context: vscode.ExtensionContext): Promise<void> {
  const key = await promptAndStoreApiKey(context);
  if (!key) {
    return;
  }
  try {
    const who = await verifyApiKey(createClient(key));
    vscode.window.showInformationMessage(`Linear API key saved (authenticated as ${who}).`);
  } catch (err) {
    logError("API key verification failed", err);
    vscode.window.showWarningMessage(
      "Linear API key saved, but a test request failed. Check the key has read access."
    );
  }
}

interface TriggerOptions {
  interactive: boolean;
  force?: boolean;
  onlyFolders?: string[];
}

async function triggerSync(
  context: vscode.ExtensionContext,
  options: TriggerOptions
): Promise<SyncSummary | undefined> {
  // Collapse concurrent requests onto the running pass.
  if (inFlight) {
    if (options.interactive) {
      vscode.window.showInformationMessage("A Linear sync is already running.");
    }
    return inFlight;
  }

  const run = doSync(context, options);
  inFlight = run;
  try {
    return await run;
  } finally {
    inFlight = undefined;
  }
}

async function doSync(
  context: vscode.ExtensionContext,
  options: TriggerOptions
): Promise<SyncSummary | undefined> {
  const config = readConfig();

  if (!config.rootFolder) {
    if (options.interactive) {
      vscode.window.showErrorMessage(
        "Linear Markdown Sync: open a workspace folder, or set an absolute linearMarkdownSync.rootFolder."
      );
    }
    return undefined;
  }

  const apiKey = options.interactive
    ? await ensureApiKey(context)
    : await getApiKey(context);

  if (!apiKey) {
    if (options.interactive) {
      vscode.window.showWarningMessage(
        "No Linear API key set. Run “Linear Markdown Sync: Set Personal API Key”."
      );
    } else {
      log("Skipping startup/auto sync: no API key set.");
    }
    return undefined;
  }

  const params: SyncParams = {
    apiKey,
    rootFolder: config.rootFolder,
    includeComments: config.includeComments,
    force: options.force,
    onlyFolders: options.onlyFolders,
  };

  const runWithProgress = () =>
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Syncing Linear tickets…" },
      () => runSync(params)
    );

  const summary = options.interactive ? await runWithProgress() : await runSync(params);

  if (options.interactive) {
    reportSummary(summary);
  }
  return summary;
}

function reportSummary(summary: SyncSummary): void {
  if (summary.total === 0 && summary.messages.length > 0) {
    vscode.window.showErrorMessage(`Linear sync: ${summary.messages[0]}`);
    return;
  }
  const parts = [`${summary.updated} updated`, `${summary.upToDate} up-to-date`];
  if (summary.notFound) parts.push(`${summary.notFound} not found`);
  if (summary.invalid) parts.push(`${summary.invalid} skipped`);
  if (summary.failed) parts.push(`${summary.failed} failed`);
  const message = `Linear sync: ${parts.join(", ")}.`;
  if (summary.failed > 0) {
    vscode.window.showWarningMessage(`${message} See “Linear Markdown Sync” output for details.`);
  } else {
    vscode.window.showInformationMessage(message);
  }
}

function setupInterval(context: vscode.ExtensionContext): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = undefined;
  }
  const { syncIntervalMinutes } = readConfig();
  if (syncIntervalMinutes > 0) {
    intervalTimer = setInterval(
      () => void triggerSync(context, { interactive: false }),
      syncIntervalMinutes * 60_000
    );
    log(`Auto-sync every ${syncIntervalMinutes} min.`);
  }
}

function setupWatcher(context: vscode.ExtensionContext): void {
  watcher?.dispose();
  watcher = undefined;

  const config = readConfig();
  if (!config.watchForNewFolders || !config.rootFolder) {
    return;
  }

  const pattern = new vscode.RelativePattern(vscode.Uri.file(config.rootFolder), "*");
  watcher = vscode.workspace.createFileSystemWatcher(pattern, false, true, true);
  watcher.onDidCreate((uri) => void onFolderCreated(context, uri));
  context.subscriptions.push(watcher);
  log(`Watching for new ticket folders in ${config.rootFolder}`);
}

async function onFolderCreated(
  context: vscode.ExtensionContext,
  uri: vscode.Uri
): Promise<void> {
  const name = path.basename(uri.fsPath);
  if (!parseIdentifier(name)) {
    return;
  }
  try {
    const stat = await fs.stat(uri.fsPath);
    if (!stat.isDirectory()) {
      return;
    }
  } catch {
    return;
  }

  // Debounce: a fresh checkout or bulk creation can fire many events at once.
  pendingWatchFolders.add(name);
  if (watchDebounce) {
    clearTimeout(watchDebounce);
  }
  watchDebounce = setTimeout(() => {
    const folders = [...pendingWatchFolders];
    pendingWatchFolders.clear();
    log(`Detected new ticket folder(s): ${folders.join(", ")}`);
    void triggerSync(context, { interactive: false, onlyFolders: folders });
  }, 800);
}
