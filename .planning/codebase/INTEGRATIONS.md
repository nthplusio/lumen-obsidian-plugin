# External Integrations

**Analysis Date:** 2026-03-11

## APIs & External Services

**Lumen Server (primary):**
- Lumen REST API — semantic search, chat, vault sync, and workspace management
  - SDK/Client: Three internal clients all extending `LumenHttpClient` (`src/http-client.ts`)
    - `ApiClient` (`src/api-client.ts`) — search and content endpoints
    - `ChatClient` (`src/chat-client.ts`) — conversations and SSE streaming
    - `SyncClient` (`src/sync/sync-client.ts`) — vault sync endpoints
  - Auth: `X-API-Key` header on every authenticated request
  - Default URL: `https://app.getlumen.io` (defined as `LUMEN_API_URL` in `src/types.ts`)
  - Custom URL: `LumenSettings.serverUrl` (user-configurable, stored in `data.json`)

**Lumen API Endpoints used:**
- `GET /health` — connectivity test, server status
- `GET /api/tags` — list all tags with document counts (also used as auth validation probe)
- `POST /api/search` — semantic search with optional filters (tags, date, folder, file type, hybrid BM25)
- `GET /api/search/content/:path` — fetch raw markdown content for a document
- `GET /api/search/context/:path` — fetch document metadata, links, sections
- `POST /api/search/similar` — find semantically similar documents
- `GET /api/workspaces/:id` — workspace info including subscription plan
- `POST /api/conversations` — create conversation
- `GET /api/conversations` — list conversations (paginated)
- `GET /api/conversations/:id` — fetch conversation with message history
- `DELETE /api/conversations/:id` — delete conversation
- `POST /api/conversations/:id/messages` — send message, returns SSE stream
- `POST /api/workspaces/:id/sync/register` — plugin registration (device ID, vault name, plugin version)
- `POST /api/workspaces/:id/sync/manifest` — hash exchange (V2 two-way sync protocol)
- `POST /api/workspaces/:id/sync/upload` — file upload as multipart/form-data
- `POST /api/workspaces/:id/sync/download` — fetch server-changed files (base64-encoded)
- `GET /api/workspaces/:id/sync/status` — sync and indexing status polling

**Dataview Plugin (optional third-party integration):**
- Lumen exposes an experimental public JS API at `app.plugins.plugins['lumen-search'].api`
- Defined in `src/dataview-api.ts`, API version `1.3.0`
- Three methods: `search()`, `getSimilar()`, `getTags()`
- No SDK dependency — Dataview users call directly via Obsidian's plugin registry

## Data Storage

**Databases:**
- None — no local database

**Settings persistence:**
- Obsidian's built-in `plugin.loadData()` / `plugin.saveData()` API
- Stored to: `{vault}/.obsidian/plugins/lumen-search/data.json`
- Schema: `LumenSettings` interface in `src/types.ts`
- Key fields: `apiKey`, `workspaceId`, `deviceId`, `lastSyncCursor`, `lastSyncSeq`, `lastSyncAt`, `debugMode`, `serverUrl`

**File Storage:**
- Local vault filesystem via Obsidian's `Vault` API
- Conflict copies written as `{original-path}.conflict.{timestamp}.md` in `src/sync/conflict-logger.ts`
- Conflict log: `.lumen-conflicts.md` in vault root

**Caching:**
- In-memory only — `FileHasher` maintains a `Map<string, {hash, mtime}>` cache keyed by `(path, mtime)` for SHA-256 hash deduplication across sync runs
- Plan info cached in-memory in `ChatClient` with 5-minute TTL

## Authentication & Identity

**Auth Provider:**
- Custom API key auth (no OAuth, no third-party identity provider)
  - Implementation: `X-API-Key` header injected by `LumenHttpClient.headers` getter in `src/http-client.ts`
  - Key stored in `LumenSettings.apiKey`, persisted to `data.json`
  - Workspace ID auto-resolved from API key on first connect via `/health` endpoint

**Device Identity:**
- `LumenSettings.deviceId` — UUID generated on first registration, persisted to `data.json`
- Sent with every sync registration (`POST /sync/register`): includes `device_id`, `device_name`, `vault_name`, `platform`, `plugin_version`

**Subscription/Plan Gating:**
- Plan tier (`free` | `pro` | `null`) fetched from `/api/workspaces/:id` and cached in `ChatClient`
- `PlanUpgradeRequiredError` thrown on 403 responses from conversations API
- `RateLimitExceededError` thrown on 429 responses

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, Datadog, or similar)

**Logs:**
- Internal `logger` singleton (`src/utils/logger.ts`)
- Levels: `debug`, `info`, `warn`, `error`
- Debug mode toggled by `LumenSettings.debugMode`
- All log output displayed in the Debug Log sidebar view (`src/debug-log-view.ts`)
- `console.*` used internally — visible in Obsidian's developer console

## CI/CD & Deployment

**Hosting:**
- Obsidian Community Plugin Marketplace (distribution)
- GitHub Releases (asset delivery: `main.js`, `manifest.json`, `styles.css`)

**CI Pipeline:**
- GitHub Actions, two workflows:
  - `.github/workflows/ci.yml` — runs on push/PR to `main` and `staging` branches
    - Steps: `npm ci` → type-check → test → help coverage check → build → verify release assets
  - `.github/workflows/release.yml` — runs on semver tags (stable + `-beta.*`)
    - Steps: `npm ci` → test → build → create GitHub Release with assets attached
    - Beta releases: prerelease flag set, includes `manifest-beta.json`

## Environment Configuration

**Required configuration (user-provided at runtime):**
- `apiKey` — Lumen API key (obtained from `getlumen.io`)
- `workspaceId` — auto-resolved from API key on first connection

**Optional configuration:**
- `serverUrl` — custom Lumen server URL (for self-hosted or staging environments); falls back to `https://app.getlumen.io`

**No environment variables are read by the plugin at runtime.** Configuration is entirely managed through Obsidian's settings UI and persisted to `data.json`.

**Secrets location:**
- `GITHUB_TOKEN` used in `release.yml` for `gh release create` — provided by GitHub Actions environment

## HTTP Transport Details

**`requestUrl` (Obsidian's API):**
- Used for all JSON endpoints: search, tags, conversations CRUD, sync manifest, sync upload, sync download, sync status, workspace info
- Runs in Electron's main process — bypasses CORS restrictions
- Cannot handle `ReadableStream` — non-streaming only

**Node.js `https`/`http` module (via `globalThis.require`):**
- Used exclusively for SSE streaming in `ChatClient.sendMessageStreaming()` (`src/chat-client.ts`)
- Required for real-time token delivery from `/api/conversations/:id/messages`
- Only available on desktop (Electron); mobile falls back to `requestUrl` (non-streaming)
- Accessed via `(globalThis as any).require('https')` — Obsidian's sandboxed `require` does not resolve Node builtins

**Multipart upload:**
- File uploads use `requestUrl` with a manually constructed multipart/form-data body (byte array built with `TextEncoder`)
- Boundary format: `----LumenUpload{timestamp}{random}`

## Webhooks & Callbacks

**Incoming:**
- None — no webhook endpoints in the plugin

**Outgoing:**
- None — plugin is a client only; all communication is outbound HTTP to the Lumen server

## SSE Streaming Protocol

**Format:** Claude-aligned SSE event format from `/api/conversations/:id/messages`
- `content_block_delta` events — incremental text tokens
- `lumen_metadata` events — sources, token usage, tools used, turn counts
- `error` events — error messages
- `thinking` events — AI thinking state indicators
- Parsed by `SSEStreamParser` (`src/utils/sse-parser.ts`) for streaming, `parseConversationSSE()` for buffered fallback

---

*Integration audit: 2026-03-11*
