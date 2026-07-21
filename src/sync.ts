import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AssetManager } from "./assets";
import { createClient, fetchIssue, parseIdentifier } from "./linear";
import { log, logError } from "./log";
import { buildIssueMarkdown, readStoredUpdatedAt } from "./markdown";

const ISSUE_FILE = "issue.md";
const MANAGED_DIRS = ["images", "attachments"];
const CONCURRENCY = 4;

export interface SyncParams {
  apiKey: string;
  rootFolder: string;
  includeComments: boolean;
  /** Re-fetch and rewrite even when timestamps match. */
  force?: boolean;
  /** Restrict the pass to these folder names (used by the folder watcher). */
  onlyFolders?: string[];
}

export interface SyncSummary {
  total: number;
  updated: number;
  upToDate: number;
  notFound: number;
  invalid: number;
  failed: number;
  messages: string[];
}

type TicketOutcome = "updated" | "upToDate" | "notFound" | "invalid" | "failed";

export async function runSync(params: SyncParams): Promise<SyncSummary> {
  const summary: SyncSummary = {
    total: 0,
    updated: 0,
    upToDate: 0,
    notFound: 0,
    invalid: 0,
    failed: 0,
    messages: [],
  };

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(params.rootFolder, { withFileTypes: true });
  } catch (err) {
    const msg = `Root folder not found or unreadable: ${params.rootFolder}`;
    logError(msg, err);
    summary.messages.push(msg);
    return summary;
  }

  let folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (params.onlyFolders && params.onlyFolders.length > 0) {
    const wanted = new Set(params.onlyFolders);
    folders = folders.filter((f) => wanted.has(f));
  }

  summary.total = folders.length;
  if (folders.length === 0) {
    log(`No ticket folders found under ${params.rootFolder}`);
    return summary;
  }

  const client = createClient(params.apiKey);

  // Simple bounded-concurrency worker pool over the folder list.
  let cursor = 0;
  const worker = async () => {
    while (cursor < folders.length) {
      const folder = folders[cursor++];
      const outcome = await syncTicketFolder(client, params, folder);
      summary[outcome] += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, folders.length) }, worker));

  log(
    `Sync complete: ${summary.updated} updated, ${summary.upToDate} up-to-date, ` +
      `${summary.notFound} not found, ${summary.invalid} invalid, ${summary.failed} failed.`
  );
  return summary;
}

async function syncTicketFolder(
  client: import("@linear/sdk").LinearClient,
  params: SyncParams,
  folder: string
): Promise<TicketOutcome> {
  const parsed = parseIdentifier(folder);
  if (!parsed) {
    log(`Skipping "${folder}": not a valid Linear identifier.`);
    return "invalid";
  }

  const ticketDir = path.join(params.rootFolder, folder);
  const issueFile = path.join(ticketDir, ISSUE_FILE);

  try {
    const issue = await fetchIssue(client, parsed, params.includeComments);
    if (!issue) {
      log(`No Linear issue found for ${parsed.teamKey}-${parsed.number} (folder "${folder}").`);
      return "notFound";
    }

    if (!params.force) {
      const stored = await readExistingUpdatedAt(issueFile);
      if (stored && stored === issue.updatedAt) {
        log(`${issue.identifier} is up to date.`);
        return "upToDate";
      }
    }

    // The issue changed (or force): rebuild managed asset dirs from scratch so
    // deleted screenshots/attachments don't linger.
    await cleanManagedDirs(ticketDir);

    const assets = new AssetManager(params.apiKey, ticketDir);
    const syncedAt = new Date().toISOString();
    const contents = await buildIssueMarkdown(
      issue,
      assets,
      params.includeComments,
      syncedAt
    );

    await fs.mkdir(ticketDir, { recursive: true });
    await fs.writeFile(issueFile, contents, "utf8");
    log(`Wrote ${issue.identifier} → ${path.join(folder, ISSUE_FILE)}`);
    return "updated";
  } catch (err) {
    logError(`Failed to sync "${folder}"`, err);
    return "failed";
  }
}

async function readExistingUpdatedAt(issueFile: string): Promise<string | null> {
  try {
    const contents = await fs.readFile(issueFile, "utf8");
    return readStoredUpdatedAt(contents);
  } catch {
    return null; // file doesn't exist yet
  }
}

async function cleanManagedDirs(ticketDir: string): Promise<void> {
  await Promise.all(
    MANAGED_DIRS.map((dir) =>
      fs.rm(path.join(ticketDir, dir), { recursive: true, force: true })
    )
  );
}
