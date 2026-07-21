# Changelog

All notable changes to this extension are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-21

Initial release.

### Added

- One-way sync of Linear issues into local markdown, one folder per ticket
  (`<root>/<identifier>/issue.md`).
- Screenshots embedded in the description are downloaded into `images/` and the
  markdown links are rewritten to point at the local copies.
- Uploaded file attachments are downloaded into `attachments/`; external links
  (GitHub, Figma, etc.) are listed as links.
- Change detection via the `updatedAt` timestamp stored in `issue.md`
  frontmatter — folders are only rewritten when the issue actually changed.
- Personal API key stored in VS Code SecretStorage (read-only access is enough).
- Commands: **Sync Now**, **Set Personal API Key**, **Clear API Key**.
- Optional sync on startup, on an interval, and automatically when a new ticket
  folder is created.
- Optional inclusion of issue comments.
