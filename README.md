# Linear Markdown Sync

A VS Code extension that syncs Linear issues **down** into local markdown files —
one folder per ticket, with screenshots and attachments downloaded alongside.

This is a one-way sync (Linear → local). It never writes back to Linear, and the
API key only needs **read** access.

## How it works

You pick a root folder (default: `linear/` in your workspace). Inside it, you
create one subfolder per ticket, named by the Linear identifier:

```
linear/
  eng-730/          ← you create this empty folder
  eng-742/
```

On each sync pass the extension scans those direct subfolders, looks up the
matching Linear issue, and fills each folder:

```
linear/eng-730/
  issue.md          ← YAML frontmatter + the issue description
  images/           ← screenshots embedded in the description
  attachments/      ← non-image uploaded files
```

Images and file links that point at `uploads.linear.app` are downloaded and the
markdown links are rewritten to the local relative paths, so everything renders
in VS Code's markdown preview. Links to external services (GitHub, Figma, etc.)
are left as-is.

### Change detection

`issue.md` stores the issue's `updatedAt` timestamp in its frontmatter. On the
next pass the extension compares it against Linear; a folder is only rewritten
when the issue actually changed (or when you run **Sync Now**, which forces a
refresh). The `images/` and `attachments/` folders are treated as managed —
they are rebuilt from scratch on each update so deleted assets don't linger.

## Setup

1. In Linear, go to **Settings → Security & access → Personal API keys** and
   create a **read-only** key.
2. In VS Code, run **`Linear Markdown Sync: Set Personal API Key`** from the
   command palette and paste it. The key is stored in VS Code SecretStorage,
   not in settings or on disk.
3. Create a `linear/` folder and add a ticket subfolder (e.g. `eng-730`).
4. Run **`Linear Markdown Sync: Sync Now`**.

## Commands

| Command | Description |
| --- | --- |
| `Linear Markdown Sync: Sync Now` | Force a full sync of every ticket folder. |
| `Linear Markdown Sync: Set Personal API Key` | Store / replace the API key. |
| `Linear Markdown Sync: Clear API Key` | Remove the stored key. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `linearMarkdownSync.rootFolder` | `linear` | Folder containing the per-ticket subfolders. Relative to the first workspace folder, or an absolute path. |
| `linearMarkdownSync.syncOnStartup` | `true` | Run a sync when the extension activates. |
| `linearMarkdownSync.syncIntervalMinutes` | `0` | Auto-sync interval in minutes (`0` disables). |
| `linearMarkdownSync.watchForNewFolders` | `true` | Sync a ticket folder automatically when it's created. |
| `linearMarkdownSync.includeComments` | `false` | Append comments to `issue.md` (and download their images). |

## Develop

```bash
npm install
npm run compile      # bundle with esbuild
npm run watch        # rebuild on change
npm run typecheck    # tsc --noEmit
npm run vsix         # produce a .vsix
```

Press `F5` in VS Code to launch an Extension Development Host.

## Notes & limits (MVP)

- Only `uploads.linear.app` assets are downloaded; other hosts stay as links.
- The `images/` and `attachments/` directories are managed by the extension and
  rebuilt on each update — don't store your own files there.
- One-way only; local edits are never pushed back to Linear and are overwritten
  when the issue changes upstream.
