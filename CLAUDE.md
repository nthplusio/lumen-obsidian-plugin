# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lumen is an Obsidian community plugin that provides semantic search and vault sync. It connects to a Lumen server (Fastify + Python worker) for AI-powered note retrieval and automatically syncs vault changes via a hash-then-fetch protocol.

Plugin ID: `lumen-search`. Part of the `@lumen/obsidian-plugin` npm workspace in the parent Lumen monorepo.

## Commands

```bash
npm run dev          # esbuild watch mode (rebuilds main.js on changes)
npm run build        # Type-check + production build (minified, no sourcemaps)
npm test             # Vitest watch mode
npm run test:run     # Vitest single run (CI mode)
npm run test:coverage # Vitest with v8 coverage
```

Run a single test file or pattern:
```bash
npx vitest run tests/sync/file-hasher.test.ts
npx vitest run -t "pattern matching"
```

There is no linter configured in this workspace. Lint/typecheck from the monorepo root:
```bash
# From repo root
npm run lint         # eslint
npm run typecheck    # tsc --build across all workspaces
```

## Architecture

### Plugin Lifecycle

`LumenPlugin` (extends `Plugin`) in `src/main.ts` is the entry point. On load:
1. Registers custom SVG icons
2. Creates `ApiClient` (REST client for search/content endpoints)
3. Auto-resolves workspace ID from API key if missing
4. Initializes sync subsystem if `apiKey + workspaceId` are configured
5. Registers three sidebar views, four commands, and a file-menu context item

### Two HTTP Client Patterns

- **`ApiClient`** (`src/api-client.ts`) — Search and content endpoints. Uses Obsidian's `requestUrl` for all calls. Authenticates via `X-API-Key` header.
- **`SyncClient`** (`src/sync/sync-client.ts`) — Sync endpoints (`/api/workspaces/:id/sync/*`). Uses `requestUrl` for JSON requests but **native `fetch`** for multipart FormData uploads (requestUrl doesn't handle FormData boundaries). Don't mix these — `requestUrl` for JSON, `fetch` for file uploads.

### Sync Subsystem (`src/sync/`)

State machine: `idle → hashing → manifest → uploading → success → idle` (with `error` reachable from any state).

Key components:
- **`SyncManager`** — Orchestrator. Vault event listeners (modify/delete/rename), debounced auto-sync (60s), manual trigger, retry with exponential backoff (max 3).
- **`FileHasher`** — SHA-256 via Web Crypto API. In-memory cache keyed by `(path, mtime)`. Processes in chunks of 50 with 10ms UI-yielding breaks.
- **`SyncClient`** — HTTP calls to the four sync endpoints: register, manifest, upload, status.
- **`ConflictLogger`** — Writes conflicts to `.lumen-conflicts.md` in vault root.
- **`SyncStatusBar`** — Status bar widget showing sync state and progress.

### Dataview Integration

`src/dataview-api.ts` exposes an experimental public JS API at `app.plugins.plugins['lumen-search'].api` for use in Dataview JS blocks. Three methods: `search()`, `getSimilar()`, `getTags()`.

### Settings & Types

`src/types.ts` defines all interfaces: `LumenSettings`, sync state types, and API response shapes that mirror `@lumen/shared`. Settings are persisted to Obsidian's `data.json` via `plugin.loadData()`/`plugin.saveData()`.

## Build System

esbuild bundles `src/main.ts` → `main.js` (CJS format, ES2018 target). The `obsidian` module and all CodeMirror/Lezer packages are externalized — they're provided by the Obsidian runtime. The output `main.js` is committed to the repo (required for Obsidian community plugin distribution).

## Testing

Vitest with the `obsidian` module aliased to `tests/__mocks__/obsidian.ts` (minimal stubs for Plugin, Vault, TFile, etc.). Tests focus on pure logic: hashing, pattern matching, error classification, sync protocol. Coverage excludes `main.ts` and `settings-tab.ts` (heavy Obsidian UI dependencies).

## Gotchas

- **`requestUrl` vs `fetch`**: `requestUrl` handles CORS in Electron but can't serialize FormData. File uploads must use native `fetch`. Never switch upload code to `requestUrl`.
- **`main.js` is committed**: The built output is checked into git because Obsidian community plugins require it. Rebuild before committing changes.
- **Sync requires both `apiKey` and `workspaceId`**: `isSyncConfigured()` gates on both. Workspace ID is auto-resolved from the API key on first connection.
- **Exclude pattern matching**: Both `FileHasher` and `SyncManager` delegate to `isExcludedByPatterns()` in `src/utils/exclude-pattern.ts`. Update the shared function, not the callers.
- **Settings persistence split**: `SyncManager` updates `settings.lastSyncCursor` and `settings.lastSyncAt` in-memory only. The caller (`main.ts`) must call `saveSettings()` after sync.
- **`noUncheckedIndexedAccess` is enabled**: Array/object index access returns `T | undefined`. Use non-null assertions (`!`) only when the index is guaranteed.
