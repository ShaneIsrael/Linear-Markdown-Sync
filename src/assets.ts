import * as fs from "node:fs/promises";
import * as path from "node:path";
import { log, logError } from "./log";

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".heic", ".avif",
]);

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "application/zip": ".zip",
  "application/json": ".json",
};

export type AssetKind = "image" | "attachment";

/** Assets uploaded to Linear live here and require an Authorization header. */
export function isLinearUpload(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "uploads.linear.app";
  } catch {
    return false;
  }
}

export function looksLikeImage(url: string, preferredName?: string): boolean {
  const candidate = preferredName || url;
  const ext = extractExtension(candidate);
  return ext !== undefined && IMAGE_EXTENSIONS.has(ext);
}

function extractExtension(value: string): string | undefined {
  try {
    const pathname = value.startsWith("http") ? new URL(value).pathname : value;
    const ext = path.extname(pathname).toLowerCase();
    return ext || undefined;
  } catch {
    const ext = path.extname(value).toLowerCase();
    return ext || undefined;
  }
}

function sanitizeName(name: string): string {
  const base = path.basename(name.trim());
  const cleaned = base
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+/, "");
  return cleaned || "file";
}

function parseContentDisposition(header: string | null): string | undefined {
  if (!header) {
    return undefined;
  }
  // filename*=UTF-8''name.png  OR  filename="name.png"
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].replace(/"/g, ""));
    } catch {
      return star[1].replace(/"/g, "");
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : undefined;
}

/**
 * Downloads assets into per-kind subfolders of a ticket directory, keeping
 * filenames unique. Instantiate one per ticket sync so a URL fetched twice
 * (e.g. referenced in both description and comments) is only written once.
 */
export class AssetManager {
  private readonly usedNames = new Map<AssetKind, Set<string>>();
  private readonly urlToRelPath = new Map<string, string>();

  constructor(
    private readonly apiKey: string,
    private readonly ticketDir: string
  ) {}

  private dirFor(kind: AssetKind): string {
    return path.join(this.ticketDir, kind === "image" ? "images" : "attachments");
  }

  private reserveName(kind: AssetKind, desired: string): string {
    let set = this.usedNames.get(kind);
    if (!set) {
      set = new Set();
      this.usedNames.set(kind, set);
    }
    const ext = path.extname(desired);
    const stem = desired.slice(0, desired.length - ext.length);
    let candidate = desired;
    let counter = 1;
    while (set.has(candidate.toLowerCase())) {
      candidate = `${stem}-${counter}${ext}`;
      counter += 1;
    }
    set.add(candidate.toLowerCase());
    return candidate;
  }

  /**
   * Downloads a single asset. Returns a POSIX relative path from the ticket
   * directory (e.g. "images/screenshot.png") suitable for a markdown link,
   * or null if the download failed (caller should keep the original URL).
   */
  async download(
    url: string,
    kind: AssetKind,
    preferredName?: string
  ): Promise<string | null> {
    const cached = this.urlToRelPath.get(url);
    if (cached) {
      return cached;
    }

    try {
      const headers: Record<string, string> = {};
      if (isLinearUpload(url)) {
        // Personal API keys are sent as the raw Authorization value.
        // undici drops this header automatically on cross-origin redirects
        // (e.g. to signed S3 URLs), which is exactly what we want.
        headers["Authorization"] = this.apiKey;
      }

      const res = await fetch(url, { headers, redirect: "follow" });
      if (!res.ok) {
        logError(`Failed to download asset (${res.status} ${res.statusText}): ${url}`);
        return null;
      }

      const disposition = parseContentDisposition(res.headers.get("content-disposition"));
      const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();

      let name = sanitizeName(disposition || preferredName || basenameFromUrl(url) || "file");
      if (!path.extname(name)) {
        const ext = CONTENT_TYPE_EXTENSIONS[contentType];
        if (ext) {
          name += ext;
        }
      }

      const finalName = this.reserveName(kind, name);
      const dir = this.dirFor(kind);
      await fs.mkdir(dir, { recursive: true });

      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(path.join(dir, finalName), buffer);

      const relPath = `${kind === "image" ? "images" : "attachments"}/${finalName}`;
      this.urlToRelPath.set(url, relPath);
      log(`Saved ${relPath} (${buffer.length} bytes)`);
      return relPath;
    } catch (err) {
      logError(`Error downloading asset: ${url}`, err);
      return null;
    }
  }
}

function basenameFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const base = path.basename(pathname);
    return base && base !== "/" ? decodeURIComponent(base) : undefined;
  } catch {
    return undefined;
  }
}
