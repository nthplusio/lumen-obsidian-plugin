# Architecture

**Analysis Date:** 2026-03-11

## Pattern Overview

**Overall:** Event-driven plugin with a React UI layer and an independent sync state machine.

**Key Characteristics:**
- `LumenPlugin` (extends Obsidian `Plugin`) is the single root orchestrator. It owns all subsystem instances and wires callbacks between them.
- UI is a React tree mounted inside an Obsidian `ItemView` wrapper (`LumenMainView`). The plugin instance is injected into React via `PluginContext`.
- Sync runs as a self-contained state machine decoupled from the UI. Sync state is bridged to React via subscriber callbacks on the plugin instance (`onSyncStateChange`, `onConflictsChange`).
- Three specialized HTTP clients all extend a shared base class `LumenHttpClient` (`src/http-client.ts`).

## Layers

**Plugin Core (Obsidian Integration):**
- Purpose: Plugin lifecycle, command registration, view management, settings persistence
- Location: `src/main.ts`
- Contains: `LumenPlugin` class, `onload`/`onunload`, sync initialization, indexing poll timers, observable state properties for React consumption
- Depends on: All other layers
- Used by: Obsidian runtime

**HTTP Clients:**
- Purpose: All communication with the Lumen server
- Location: `src/http-client.ts` (base), `src/api-client.ts`, `src/chat-client.ts`, `src/sync/sync-client.ts`
- Contains: Three concrete clients inheriting from `LumenHttpClient`. `ApiClient` handles search/content endpoints. `ChatClient` handles conversations and SSE streaming. `SyncClient` handles the four sync endpoints.
- Depends on: `src/types.ts`, Obsidian `requestUrl`
- Used by: `LumenPlugin`, `SyncManager`, React hooks via plugin reference

**Sync Subsystem:**
- Purpose: Two-way vault synchronization via hash-then-fetch protocol
- Location: `src/sync/`
- Contains: `SyncManager` (orchestrator), `FileHasher` (SHA-256 with cache), `SyncClient` (HTTP), `SyncStatusBar` (status bar widget), `ConflictLogger` (conflict log file), `ConflictResolutionModal`, `WorkspaceConfirmationModal`
- Depends on: `src/utils/`, `src/types.ts`, Obsidian Vault API
- Used by: `LumenPlugin` (`initializeSync`)

**React UI:**
- Purpose: All sidebar and modal UI presented to the user
- Location: `src/ui/`, `src/main-view.tsx`
- Contains: `LumenApp.tsx` (root), view components (`SearchView`, `ChatView`, `RelatedNotesView`, `OnboardingView`), feature hooks (`useSearch`, `useChat`, `useSyncState`, `usePlanState`, `useConflicts`, `useRelatedNotes`), shared components, `PluginContext` provider
- Depends on: Plugin instance via `PluginContext`, HTTP clients via plugin
- Used by: `LumenMainView` (mounts the React root)

**Utilities:**
- Purpose: Cross-cutting pure logic shared across subsystems
- Location: `src/utils/`
- Contains: `logger.ts` (ring buffer + redaction), `error-classifier.ts` (HTTP error categorization), `exclude-pattern.ts` (glob matching), `network-status.ts` (online/offline singleton), `path-safety.ts` (path traversal guards), `sse-parser.ts` (SSE stream parsing)
- Depends on: Nothing (no internal imports)
- Used by: All other layers

**Types:**
- Purpose: Shared TypeScript interfaces and error classes
- Location: `src/types.ts`
- Contains: `LumenSettings`, all API response shapes, sync state types, chat types, plan types, custom error classes (`WorkspaceConfirmationError`, `PlanUpgradeRequiredError`, `RateLimitExceededError`)
- Depends on: Nothing
- Used by: All other layers

## Data Flow

**Search Query:**
1. User types in `SearchView` → `useSearch` debounces 300ms
2. `useSearch` calls `plugin.apiClient.semanticSearch()`
3. `ApiClient` calls `POST /api/search` via `requestUrl`
4. Results dispatched into `useReducer` state → React re-renders results

**Sync Cycle:**
1. `SyncManager` triggers (vault event debounce, auto-sync timer, or manual call)
2. State transitions: `idle → hashing → manifest → uploading → (downloading if server changes) → success`
3. `FileHasher.hashAllFiles()` — chunked SHA-256 of vault files
4. `SyncClient.sendManifestV2()` — POST local hashes to server, receive needed/deleted/changed lists
5. `SyncClient.uploadFiles()` — FormData upload of changed files (native `fetch`, not `requestUrl`)
6. If server changes: `SyncClient.downloadFiles()` → vault writes
7. Conflict detection → `ConflictLogger.logConflicts()` → `UnresolvedConflict[]` stored on plugin
8. `onSyncComplete` callback fires → `LumenPlugin.saveSettings()` + notifies React subscribers

**Chat Streaming:**
1. `ChatView` submits message → `useChat` calls `plugin.chatClient.sendMessage()`
2. `ChatClient` opens SSE stream via Node `https` module (desktop) or `requestUrl` fallback (mobile)
3. `SSEStreamParser` parses `lumen_text`, `lumen_metadata`, `lumen_tool_use` events
4. Streamed tokens appended to `ChatMessage.content` → React re-renders on each chunk

**Settings Change:**
1. User changes a setting in `LumenSettingTab`
2. `plugin.saveSettings()` called
3. All HTTP clients updated via `updateSettings()`
4. `notifySettingsListeners()` fires → React `PluginContext` consumers re-render

**State Management:**
- Plugin instance holds mutable observable state (`currentSyncState`, `currentPlanTier`, `unresolvedConflicts`)
- React components subscribe via plugin listener methods (`onSyncStateChange`, `onPlanChange`, `onConflictsChange`, `onSettingsChange`) in `useEffect` hooks
- Hooks (`useSyncState`, `usePlanState`, `useConflicts`) bridge plugin observables to React `useState`
- No external state library — all state lives either in `LumenPlugin` properties or React `useReducer`/`useState`

## Key Abstractions

**LumenHttpClient:**
- Purpose: Base class providing `baseUrl`, `headers`, and credential management for all three HTTP clients
- Examples: `src/http-client.ts`, extended by `src/api-client.ts`, `src/chat-client.ts`, `src/sync/sync-client.ts`
- Pattern: Template Method — subclasses call `this.baseUrl` and `this.headers`, override nothing

**SyncState machine:**
- Purpose: Typed states for the sync lifecycle with valid transitions
- Examples: `src/types.ts` (`SyncState`), enforced in `src/sync/sync-manager.ts`
- Pattern: String union type (`'idle' | 'hashing' | 'manifest' | 'uploading' | 'downloading' | 'resolving-conflicts' | 'success' | 'error' | 'offline' | 'cancelled'`)

**PluginContext:**
- Purpose: Dependency injection of `LumenPlugin`, `App`, `ItemView`, and `Component` into the React tree without prop drilling
- Examples: `src/ui/contexts/PluginContext.tsx`
- Pattern: React context with `usePlugin()` consumer hook

**FileHasher cache:**
- Purpose: Avoid re-hashing files that haven't changed since last sync
- Examples: `src/sync/file-hasher.ts`
- Pattern: In-memory `Map<path, { hash, mtime }>` keyed by `(path, mtime)` — cache entry is invalidated on modify/rename/delete

**ClassifiedError:**
- Purpose: Normalized error shape with category, user-facing message, and retryability flag
- Examples: `src/utils/error-classifier.ts`
- Pattern: Pure function `classifyError(err) → ClassifiedError` consumed by `useSearch` and `SyncManager`

## Entry Points

**LumenPlugin (onload):**
- Location: `src/main.ts` — `LumenPlugin.onload()`
- Triggers: Obsidian loads the plugin on vault open
- Responsibilities: Icon registration, settings load, API client init, workspace ID auto-resolve, sync initialization, view and command registration, ribbon icon

**LumenMainView (onOpen):**
- Location: `src/main-view.tsx` — `LumenMainView.onOpen()`
- Triggers: User opens the Lumen sidebar (ribbon icon, command, or Obsidian layout restore)
- Responsibilities: Creates React root, renders `LumenApp` with `PluginContext` value

**SyncManager (syncNow):**
- Location: `src/sync/sync-manager.ts` — `SyncManager.syncNow()`
- Triggers: Manual command, vault file change debounce (60s), auto-sync timer, network restore
- Responsibilities: Full sync cycle from hashing through upload/download to conflict resolution

## Error Handling

**Strategy:** Classify then decide — errors are passed through `classifyError()` to get a `ClassifiedError` with `retryable: boolean`. Retryable errors (network, timeout) trigger exponential backoff; non-retryable (auth, validation) surface immediately.

**Patterns:**
- HTTP clients throw raw errors; callers call `classifyError()` to normalize
- `SyncManager` retries with exponential backoff (max 3 attempts, base 1s)
- `useSearch` retries up to 2 times with 1s delay multiplier
- `ConflictLogger` catches write errors and logs them without re-throwing (best-effort)
- All error categories: `'network' | 'auth' | 'server' | 'timeout' | 'validation' | 'rate-limit' | 'config' | 'unknown'`

## Cross-Cutting Concerns

**Logging:** Singleton `logger` (`src/utils/logger.ts`). Ring buffer of 500 entries. `debug`/`info` gated behind `settings.debugMode`; `warn`/`error` always output. All logs redact API keys matching `vr_*` pattern. Consumed by `LumenDebugLogView` via `logger.onEntry()` listener.

**Validation:** Path traversal validated in `src/utils/path-safety.ts` (`isSafePath`) before any vault write on server-provided paths. Markdown injection escaped with `escapeMd` for conflict log entries.

**Authentication:** All requests authenticated via `X-API-Key` header. Header built in `LumenHttpClient.headers` getter. Never logged — redacted by logger before output.

---

*Architecture analysis: 2026-03-11*
