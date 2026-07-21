import matter from "gray-matter";
import { AssetManager, isLinearUpload, looksLikeImage } from "./assets";
import type { IssueData } from "./linear";

// Matches markdown images and links: an optional leading "!", the bracketed
// text, then the URL in parens (optionally <>-wrapped) with an optional title.
const LINK_RE = /(!?)\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)((?:\s+"[^"]*")?)\s*\)/g;

/**
 * Rewrites Linear-hosted upload links in markdown so they point at locally
 * downloaded copies. External links are left untouched. Returns the rewritten
 * markdown.
 */
async function rewriteAssetLinks(md: string, assets: AssetManager): Promise<string> {
  if (!md) {
    return "";
  }

  const matches = [...md.matchAll(LINK_RE)];
  if (matches.length === 0) {
    return md;
  }

  const edits = await Promise.all(
    matches.map(async (m) => {
      const full = m[0];
      const start = m.index ?? 0;
      const bang = m[1];
      const text = m[2];
      const rawUrl = m[3].replace(/^<|>$/g, "");
      const title = m[4] ?? "";

      if (!isLinearUpload(rawUrl)) {
        return { start, end: start + full.length, replacement: full };
      }

      const isImage = bang === "!" || looksLikeImage(rawUrl, text);
      const relPath = await assets.download(
        rawUrl,
        isImage ? "image" : "attachment",
        text || undefined
      );

      if (!relPath) {
        return { start, end: start + full.length, replacement: full };
      }

      const replacement = `${bang}[${text}](${relPath}${title})`;
      return { start, end: start + full.length, replacement };
    })
  );

  // Apply edits back-to-front so earlier indices stay valid.
  edits.sort((a, b) => b.start - a.start);
  let result = md;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}

function buildFrontmatter(issue: IssueData, syncedAt: string): Record<string, unknown> {
  const data: Record<string, unknown> = {
    identifier: issue.identifier,
    title: issue.title,
  };
  if (issue.state) data.state = issue.state;
  if (issue.assignee) data.assignee = issue.assignee;
  if (issue.priority) data.priority = issue.priority;
  if (issue.labels.length > 0) data.labels = issue.labels;
  if (issue.team) data.team = issue.team;
  if (issue.project) data.project = issue.project;
  if (typeof issue.estimate === "number") data.estimate = issue.estimate;
  data.url = issue.url;
  data.createdAt = issue.createdAt;
  data.updatedAt = issue.updatedAt; // used by the sync engine for change detection
  data.syncedAt = syncedAt;
  return data;
}

/**
 * Builds the full issue.md contents (frontmatter + body), downloading any
 * referenced Linear uploads through the AssetManager as a side effect.
 */
export async function buildIssueMarkdown(
  issue: IssueData,
  assets: AssetManager,
  includeComments: boolean,
  syncedAt: string
): Promise<string> {
  const sections: string[] = [];

  sections.push(`# ${issue.identifier} — ${issue.title}`);

  const description = await rewriteAssetLinks(issue.description, assets);
  sections.push(description.trim() || "_No description._");

  if (issue.attachments.length > 0) {
    const lines = ["## Attachments"];
    for (const att of issue.attachments) {
      let target = att.url;
      if (isLinearUpload(att.url)) {
        const rel = await assets.download(att.url, "attachment", att.title);
        if (rel) {
          target = rel;
        }
      }
      const label = att.title || att.url;
      const suffix = att.subtitle ? ` — ${att.subtitle}` : "";
      lines.push(`- [${label}](${target})${suffix}`);
    }
    sections.push(lines.join("\n"));
  }

  if (includeComments && issue.comments.length > 0) {
    const lines = ["## Comments"];
    for (const c of issue.comments) {
      const body = await rewriteAssetLinks(c.body, assets);
      lines.push(`### ${c.author} — ${c.createdAt}`);
      lines.push(body.trim() || "_(empty)_");
    }
    sections.push(lines.join("\n\n"));
  }

  const body = sections.join("\n\n") + "\n";
  return matter.stringify(body, buildFrontmatter(issue, syncedAt));
}

/**
 * Reads the updatedAt timestamp previously written into an issue.md file.
 * Returns null when the file has no parseable frontmatter timestamp.
 */
export function readStoredUpdatedAt(fileContents: string): string | null {
  try {
    const parsed = matter(fileContents);
    const value = parsed.data?.updatedAt;
    if (typeof value === "string") {
      return value;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return null;
  } catch {
    return null;
  }
}
