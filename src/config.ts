import * as path from "node:path";
import * as vscode from "vscode";

export interface SyncConfig {
  /** Absolute path to the folder that holds one subfolder per ticket. */
  rootFolder: string | undefined;
  syncIntervalMinutes: number;
  syncOnStartup: boolean;
  watchForNewFolders: boolean;
  includeComments: boolean;
}

export function readConfig(): SyncConfig {
  const cfg = vscode.workspace.getConfiguration("linearMarkdownSync");
  const rawRoot = (cfg.get<string>("rootFolder") ?? "linear").trim();

  return {
    rootFolder: resolveRootFolder(rawRoot),
    syncIntervalMinutes: Math.max(0, cfg.get<number>("syncIntervalMinutes") ?? 0),
    syncOnStartup: cfg.get<boolean>("syncOnStartup") ?? true,
    watchForNewFolders: cfg.get<boolean>("watchForNewFolders") ?? true,
    includeComments: cfg.get<boolean>("includeComments") ?? false,
  };
}

/**
 * Resolves the configured root folder. Absolute paths are used verbatim;
 * relative paths resolve against the first workspace folder. Returns
 * undefined when a relative path is configured but no workspace is open.
 */
function resolveRootFolder(raw: string): string | undefined {
  if (path.isAbsolute(raw)) {
    return raw;
  }
  const first = vscode.workspace.workspaceFolders?.[0];
  if (!first) {
    return undefined;
  }
  return path.join(first.uri.fsPath, raw);
}
