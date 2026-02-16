# Lumen

Your vault, illuminated — AI-powered semantic search and vault sync for Obsidian.

## Description

Lumen connects your Obsidian vault to a [Lumen](https://getlumen.io) server, giving you semantic search that finds notes by *meaning*, not just keywords. Your vault is automatically synced and indexed so search results stay current as your notes evolve.

Type a natural language query like "notes about project planning" or "ideas from last week's meeting" and get ranked results with relevant snippets — click any result to jump straight to the file.

## Features

### Semantic Search
- **Natural language queries** — find notes by meaning, not exact keyword matches
- **Ranked results with snippets** — each result shows a relevant excerpt with highlighted terms
- **Click to open** — jump directly to any result in your vault
- **Relevance scores** — color-coded indicators show how closely each result matches your query
- **Tag display** — see tags on each result for quick context

### Vault Sync
- **Automatic synchronization** — vault changes are synced to Lumen on a configurable interval
- **Efficient transfers** — only changed files are uploaded using content-hash comparison
- **Exclude patterns** — skip directories or files you don't want indexed
- **Manual sync** — trigger a sync anytime from the command palette
- **Conflict logging** — when the server and vault disagree, details are logged for review

### Additional Features
- **Status bar** — real-time sync progress and last-sync timestamp in the Obsidian status bar
- **Debug log viewer** — inspect plugin activity and diagnose issues without the developer console
- **In-app help** — built-in documentation accessible from the settings panel
- **Light and dark themes** — fully adapts to your Obsidian theme using native CSS variables

## Installation

### From Obsidian Community Plugins

1. Open **Settings** in Obsidian
2. Go to **Community Plugins** and disable Restricted Mode if prompted
3. Click **Browse** and search for **"Lumen"**
4. Click **Install**, then **Enable**

### Manual Installation

1. Download the latest release (`main.js`, `manifest.json`, `styles.css`) from the [releases page](https://github.com/nthplusio/lumen-obsidian-plugin/releases)
2. Create a folder at `.obsidian/plugins/lumen-search/` in your vault
3. Copy the downloaded files into that folder
4. Restart Obsidian or reload plugins
5. Enable **Lumen** in **Settings > Community Plugins**

## Quick Start

1. **Install** the plugin (see above)
2. **Open Settings > Lumen** and enter your Lumen server URL (e.g., `https://app.getlumen.io`)
3. **Enter your API key** (starts with `vr_`) — obtain one from your Lumen server's admin panel
4. **Click "Test Connection"** to verify the plugin can reach your server
5. **Enable sync** — toggle "Enable automatic sync" and set your preferred interval
6. **Search** — click the search icon in the ribbon or use the command palette (`Ctrl/Cmd+P` > "Search vault with Lumen")

## Configuration

All settings are found under **Settings > Lumen**, organized into three collapsible sections.

### Connection

| Setting | Default | Description |
|---------|---------|-------------|
| API Endpoint URL | *(empty)* | Your Lumen server URL (e.g., `https://app.getlumen.io`). Must use HTTPS for non-localhost servers. |
| API Key | *(empty)* | Your Lumen API key (starts with `vr_`). Obtain one from your server's admin panel. |
| Test Connection | — | Button to verify the plugin can reach your Lumen server. |

### Vault Sync

| Setting | Default | Description |
|---------|---------|-------------|
| Enable automatic sync | Off | Toggle automatic vault synchronization on or off. |
| Auto-sync interval | 5 minutes | How often to check for and sync changes. Options: manual only, 1/2/5/10/15/30/60 minutes. Set to "Manual only" to sync only via the command palette. |
| Exclude patterns | `.obsidian/`, `.trash/` | File paths matching these patterns are skipped during sync. Add patterns like `templates/` or `archive/` to exclude directories. |

### Advanced

| Setting | Default | Description |
|---------|---------|-------------|
| Workspace ID | *(set during registration)* | The workspace this vault syncs to. Read-only — assigned when you connect. |
| Device ID | *(auto-generated)* | Unique identifier for this device. Read-only. |
| Debug mode | Off | Enables verbose logging to the developer console and the debug log viewer. |

## Vault Sync

### How Sync Works

Vault sync uses a **hash-then-fetch** protocol that minimizes bandwidth:

1. **Hash** — The plugin computes SHA-256 content hashes for all `.md` files in your vault (respecting exclude patterns). Hashes are cached using file modification times, so only files that changed since the last check are re-hashed.

2. **Compare** — The plugin sends a manifest of file paths, hashes, and actions to the server. The server compares with its own records and replies with a list of files it needs.

3. **Upload** — Only the files the server requested are transferred. Unchanged files are never sent.

4. **Index** — The server stores the uploaded files and triggers re-indexing, making new content searchable.

A vault with 1,000 files where only 3 changed will transfer just those 3 files.

### Exclude Patterns

Add patterns in **Settings > Lumen > Vault Sync > Exclude patterns** to skip files or directories:

- `.obsidian/` — Obsidian's internal config (excluded by default)
- `.trash/` — Obsidian's trash folder (excluded by default)
- `templates/` — Template files you don't want searchable
- `daily/2023/` — Old daily notes you want to skip

Patterns match against the file path from the vault root. A trailing `/` matches directories.

### Conflict Handling

Lumen uses a **last-write-wins** strategy: your local version always takes precedence over the server copy.

When conflicts are detected, they are logged to **`.lumen-conflicts.md`** in your vault root. Each entry records the file path, conflict type, content hashes, and the resolution applied. You can view this file from **Settings > Lumen > Vault Sync > View Conflict Log**.

The conflict log is append-only — you can safely delete it at any time, and it will be recreated on the next conflict. File content is never written to the log; only metadata (paths, hashes, timestamps).

### Sync Performance

The sync system is designed for large vaults:

- **Hash caching** — Only files whose modification time changed are re-hashed
- **Chunked processing** — Files are hashed in batches of 50 with brief pauses to keep Obsidian responsive
- **Incremental sync** — Cursor-based tracking means only changes since the last sync are processed

Expected performance (warm cache): ~2 seconds for 1,000 files, ~10 seconds for 10,000 files.

## Semantic Search

### Using Search

Open the search panel in one of two ways:

- Click the **search icon** in the ribbon (left sidebar)
- Use the command palette: `Ctrl/Cmd+P` > **"Search vault with Lumen"**

Type a natural language query in the search box. Results appear ranked by relevance with a snippet from the matching section of each note.

### Query Tips

- **Be specific** — "meeting notes about Q4 budget review" works better than "meetings"
- **Use natural phrasing** — ask questions the way you would describe a note to a colleague
- **Try synonyms** — semantic search understands meaning, so "happy", "glad", and "joyful" all find similar notes
- **Include context** — "Python script for parsing CSV files" is more targeted than "parsing"

### Understanding Scores

Each result displays a relevance score with a color indicator:

- **Green (high)** — strong semantic match; the note is closely related to your query
- **Yellow (medium)** — partial match; the note touches on your topic
- **Red (low)** — weak match; the note has some relation but may not be what you're looking for

## Debug Log

The debug log viewer lets you inspect plugin activity without opening the developer console.

### Accessing the Debug Log

1. Enable **Debug mode** in **Settings > Lumen > Advanced**
2. Open the debug log viewer from the command palette or the settings panel
3. The log shows timestamped entries for sync operations, search queries, connection events, and errors

The debug log uses a ring buffer — older entries are automatically discarded to limit memory usage. All entries with API keys or sensitive data are automatically redacted.

## Troubleshooting

### "Connection failed" on test

- Verify the server URL includes the protocol (`https://`)
- Check that the API key starts with `vr_` and is complete
- Ensure the Lumen server is running and reachable from your network
- If using a self-hosted server, confirm the port is correct

### Sync not starting

- Ensure both an **API key** and **Workspace ID** are set — sync requires both
- Confirm **Enable automatic sync** is toggled on
- Check that the auto-sync interval is not set to "Manual only" (unless you intend to sync manually)
- Verify the connection test passes

### "Conflicts logged" notice

- Open `.lumen-conflicts.md` in your vault root (or use the "View Conflict Log" button in settings)
- This is informational — your local files are never modified during sync
- Conflicts occur when the same file was changed on another device or directly on the server

### Sync is slow

- The first sync hashes all files and takes longer; subsequent syncs use cached hashes
- Large vaults (10,000+ files) may take 10+ seconds for the initial hash pass
- Add exclude patterns for large directories you don't need indexed (e.g., `node_modules/`, `assets/`)

### Search returns no results

- Confirm the connection test passes in settings
- Verify that at least one sync has completed — files must be indexed before they are searchable
- Try broadening your query
- Check that the files you expect aren't excluded by your sync patterns

### Plugin not appearing after install

- Ensure **Restricted Mode** is disabled in **Settings > Community Plugins**
- Check that the plugin files are in `.obsidian/plugins/lumen-search/` (not a subdirectory)
- Restart Obsidian after manual installation

## Privacy and Security

### API Key Storage

Your API key is stored in **plaintext** in Obsidian's plugin data file:

```
.obsidian/plugins/lumen-search/data.json
```

This is a limitation of the Obsidian plugin API, which does not provide a secure credential store. **Do not share or commit this file publicly.** If your vault is in a git repository, add `.obsidian/plugins/` to your `.gitignore`.

### What Data Is Sent

- **During sync**: File paths, content hashes (SHA-256), and the contents of changed `.md` files are sent to your Lumen server.
- **During search**: Your search query text is sent to your Lumen server.
- **No telemetry**: The plugin does not collect analytics or send data to any third party. All communication is between the plugin and your configured Lumen server.

### Recommendations

- Use **HTTPS** for your server URL (enforced for non-localhost connections)
- Generate a dedicated API key for the plugin and rotate it periodically
- Keep your `.obsidian/plugins/` directory out of version control
- Review exclude patterns to avoid syncing sensitive files

## Requirements

- [Obsidian](https://obsidian.md) v0.15.0 or later
- A running [Lumen](https://getlumen.io) server
- An API key from your Lumen server (prefixed with `vr_`)

## Support

- [Documentation](https://getlumen.io/docs/obsidian)
- [Report an Issue](https://github.com/nthplusio/lumen-obsidian-plugin/issues)
- [Lumen Website](https://getlumen.io)

## License

This plugin is released under the [MIT License](LICENSE).
