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
3. **Enter your API key** (starts with `vr_`) — obtain one from your Lumen account.
4. **Click "Test Connection"** to verify the plugin can reach your server
5. **Enable sync** — toggle "Enable automatic sync" and set your preferred interval
6. **Search** — click the search icon in the ribbon or use the command palette (`Ctrl/Cmd+P` > "Search vault with Lumen")

## Configuration

All settings are found under **Settings > Lumen**, organized into three collapsible sections.

### Connection

| Setting | Default | Description |
|---------|---------|-------------|
| API Endpoint URL | *(empty)* | Your Lumen server URL (e.g., `https://app.getlumen.io`). Must use HTTPS. |
| API Key | *(empty)* | Your Lumen API key (starts with `vr_`). Obtain one from your Lumen account. |
| Test Connection | — | Button to verify the plugin can reach your Lumen server. |