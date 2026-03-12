# Codebase Concerns

**Analysis Date:** 2026-03-11

## Tech Debt

**Dual exclude-pattern state in SyncManager:**
- Issue: `SyncManager` maintains its own `currentExcludePatterns` array that it uses for vault event filtering, but also directly mutates `fileHasher.excludePatterns`. These two copies must be kept in sync manually. The same update is made in two code paths (registration and status fetch), and they must always be updated together.
- Files: `src/sync/sync-manager.ts` (lines 95, 420-421, 438-439, 943, 961, 984, 989), `src/sync/file-hasher.ts` (line 43)
- Impact: If a new code path updates one but not the other, event-driven filtering diverges from hashing filtering, causing files to be included/excluded inconsistently.
- Fix approach: Remove `currentExcludePatterns` from `SyncManager`; delegate all exclude-pattern logic to `FileHasher` by reading `fileHasher.excludePatterns` in the event handlers.

**Duplicate integration test files:**
- Issue: Two almost-identical integration test files exist with slightly different names and content: `tests/integration/v13-features.test.ts` and `tests/integration/v1.3-features.test.ts`. Both cover event-driven sync, dataview API delegation, and debounce behavior.
- Files: `tests/integration/v13-features.test.ts`, `tests/integration/v1.3-features.test.ts`
- Impact: Maintenance burden — changes to the sync or dataview API need to be reflected in two places. Tests may give false confidence if only one file is updated.
- Fix approach: Delete one file (likely `v13-features.test.ts` which has a slightly older format) and consolidate tests into `v1.3-features.test.ts`.

**Double settings save on sync completion:**
- Issue: `SyncManager.executeSyncAttempt()` calls `this.plugin.saveData(this.settings)` directly (line 672), and then `main.ts` also calls `await this.saveSettings()` inside `onSyncComplete` (line 526). This results in two disk writes per sync cycle. `saveSettings()` also triggers side effects (notifying listeners, rebuilding ChatClient) unnecessarily.
- Files: `src/sync/sync-manager.ts` (line 672), `src/main.ts` (lines 525-526)
- Impact: Unnecessary I/O and unintended side effects (e.g., listener notifications fire twice after sync). The comment in `sync-manager.ts` says "BUG-2 fix" but the design creates new redundancy.
- Fix approach: Remove the `saveData` call from `SyncManager` and rely solely on the `onSyncComplete` callback path in `main.ts`, which is the intended architecture (as documented in CLAUDE.md).

**`initializeSync` called via `any` cast in onboarding:**
- Issue: `OnboardingView.tsx` calls `await (plugin as any).initializeSync?.()` because `initializeSync` is a `private` method on `LumenPlugin`. This bypasses TypeScript access control.
- Files: `src/ui/components/onboarding/OnboardingView.tsx` (line 98), `src/main.ts` (line 478)
- Impact: If `initializeSync` signature or behavior changes, the onboarding call silently breaks with no compile-time error.
- Fix approach: Make `initializeSync` `public` or add a dedicated `reinitializeSync()` method on `LumenPlugin` that the onboarding view can call safely.

**`uploadBatchWithRetry` uses recursion instead of a loop:**
- Issue: The batch upload retry logic in `SyncManager.uploadBatchWithRetry()` calls itself recursively with `retryCount + 1`. With `BATCH_MAX_RETRIES = 3`, this creates a stack depth of 4 calls.
- Files: `src/sync/sync-manager.ts` (lines 1101-1127)
- Impact: Minor — the bounded retry depth prevents true stack overflow, but it is non-idiomatic and harder to reason about than a `while` loop.
- Fix approach: Refactor to an iterative `for` loop pattern matching how `executeSync` handles retries.

**`isExcludedByPatterns` creates new `RegExp` per pattern per file:**
- Issue: `isExcludedByPatterns()` constructs a `new RegExp(...)` for every pattern on every call. During a full vault hash, this function is called once per file per pattern — with 5,000 files and 10 patterns, that is 50,000 RegExp constructions.
- Files: `src/utils/exclude-pattern.ts` (line 32)
- Impact: CPU overhead during large vault sync. Unlikely to be user-visible for typical vault sizes, but becomes measurable for vaults with thousands of files.
- Fix approach: Pre-compile the patterns to `RegExp[]` when patterns are updated (in `FileHasher`) and pass pre-compiled regexps into a revised `isExcludedByPatterns` overload.

## Security Considerations

**Server-provided `download_endpoint` has shallow validation:**
- Risk: `SyncClient.downloadFiles()` validates the server-provided endpoint with `!endpoint.startsWith('/api/')`. This check only requires the path to begin with `/api/` — a server could return `/api/../internal/secrets` or similar and bypass the protection.
- Files: `src/sync/sync-client.ts` (lines 354-355)
- Current mitigation: Path traversal in the endpoint string itself is blocked by the `startsWith` check. `isSafePath()` validates individual file paths written to disk.
- Recommendations: Add stricter endpoint validation — use a URL parser to extract the path and verify it matches an expected shape (e.g., `/api/workspaces/<uuid>/sync/download`), or use an allowlist of known safe endpoint patterns.

**`(app as any).setting` pattern exposes undocumented Obsidian API:**
- Risk: Three locations use `(app as any).setting?.open?.()` and `(app as any).setting?.openTabById?.()` to programmatically open the settings panel. This relies on an internal Obsidian API that is not typed or guaranteed to remain stable.
- Files: `src/ui/components/shared/ErrorState.tsx` (lines 48-49), `src/ui/components/search/SearchView.tsx` (lines 347-348)
- Current mitigation: Optional chaining (`?.`) means it fails silently if the API is absent.
- Recommendations: Document as a known Obsidian internal API dependency. Consider a fallback of displaying a `Notice` with the settings path if the API is unavailable.

**API key stored in plaintext `data.json`:**
- Risk: Obsidian stores plugin data in `<vault>/.obsidian/plugins/lumen-search/data.json`. The API key is stored in plaintext in this file, which is accessible to any process with read access to the vault directory.
- Files: `src/types.ts` (LumenSettings interface), `src/main.ts` (loadSettings/saveSettings)
- Current mitigation: Redaction in logger (`src/utils/logger.ts`) prevents key leakage to console or debug log.
- Recommendations: This is a known limitation of the Obsidian plugin model — there is no platform-provided secure storage API. Ensure the API key is short-lived and revocable from the server side.

## Performance Bottlenecks

**Full vault hash on every sync cycle:**
- Problem: Every sync run (including auto-sync triggered by file events) calls `fileHasher.hashAllFiles()` which iterates all vault files. For a 10,000-file vault, this is 10,000 file stat reads and potentially thousands of file content reads (cache misses).
- Files: `src/sync/sync-manager.ts` (lines 457-463), `src/sync/file-hasher.ts` (lines 70-121)
- Cause: The hash-then-fetch protocol requires a full manifest for the server diff. The in-memory cache (keyed by `path + mtime`) mitigates reads, but stat reads still happen for all files.
- Improvement path: The existing `pendingChanges` set already tracks changed files. For incremental syncs (non-first-connect), only hash files in `pendingChanges` and reuse cached hashes for all others. The manifest would still need all files but hashes could be populated from a persistent cache.

**Base64 decode allocates two full copies for binary downloads:**
- Problem: `SyncManager.decodeBase64()` (line 1253) uses `atob()` which returns a string, then creates a `Uint8Array` by iterating char codes. For large binary files this means the content exists simultaneously as a base64 string, a decoded string (from `atob`), and a `Uint8Array`.
- Files: `src/sync/sync-manager.ts` (lines 1253-1262)
- Cause: `atob()` does not return `Uint8Array` directly; charCode iteration is the only cross-platform approach without a polyfill.
- Improvement path: For large binary files, `TextDecoder` with `{ fatal: true }` on a `Uint8Array` derived from `Uint8Array.from()` can reduce allocations slightly, but the fundamental constraint is the base64 wire format.

**`appendEntry` in debug log recounts all visible entries on every new log entry:**
- Problem: Every new log entry calls `logger.getEntries().filter(...)` to recount visible entries for the count display. At 500 entries and high log volume (e.g., during large sync), this recounts on every log event.
- Files: `src/debug-log-view.ts` (lines 189-192)
- Cause: The count is recalculated from scratch instead of being maintained incrementally.
- Improvement path: Track visible count as an instance variable, incrementing on `appendEntry` if the entry passes the filter.

## Fragile Areas

**`SyncManager` is directly coupled to `LumenPlugin` via `Plugin` type:**
- Files: `src/sync/sync-manager.ts` (lines 65, 391, 431, 672, 839, 841, 907, 916, 931-955)
- Why fragile: `SyncManager` calls `this.plugin.app`, `this.plugin.saveData()`, `this.plugin.manifest.version`, and `this.plugin.registerEvent()`. It also instantiates `WorkspaceConfirmationModal`. This tight coupling makes isolated unit testing of `SyncManager` difficult and means changes to `LumenPlugin`'s structure directly affect sync behavior.
- Safe modification: Any change to `LumenPlugin`'s public interface (especially `saveData`, `app`, or `manifest`) requires checking `SyncManager` for affected call sites.
- Test coverage: `tests/sync/sync-manager.test.ts` and `tests/sync/sync-manager-v2.test.ts` use mocked `Plugin` objects, so coupling is partially obscured.

**`ChatClient.resolveNodeTransport()` relies on `globalThis.require`:**
- Files: `src/chat-client.ts` (lines 213-228)
- Why fragile: The streaming chat path uses `(globalThis as any).require` to load Node.js `https`/`http` at runtime, bypassing Obsidian's module sandbox. If Obsidian changes its Electron sandboxing or module resolution, streaming breaks silently and falls back to the non-streaming path (no error, just degraded UX with tokens arriving all at once).
- Safe modification: Always test streaming after Obsidian version bumps.
- Test coverage: Not covered in tests — streaming path is desktop-only and requires a live Electron environment.

**Conflict copy path generation has a secondary collision race:**
- Files: `src/sync/sync-manager.ts` (lines 1232-1243)
- Why fragile: `generateConflictPath()` checks if `<base>.conflict.md` exists, and if so appends a Unix timestamp. Between the check and the write, another sync cycle or external process could create that path, causing a write failure. The timestamp fallback also only has second resolution — two conflicts for the same file within the same second both produce the same path.
- Safe modification: Wrap `writeToVault(conflictPath, ...)` in a try/catch that falls back to a UUID-based path if the timestamp path collides.
- Test coverage: Partially covered in `tests/sync/conflict-logger.test.ts` but the race condition itself is not tested.

**Onboarding `handleFinish` does not await `initializeSync`:**
- Files: `src/ui/components/onboarding/OnboardingView.tsx` (lines 91-100)
- Why fragile: If `plugin.syncManager` is null (first-time setup), the code calls `await (plugin as any).initializeSync?.()`, but the `handleFinish` callback is passed to a button's `onClick` without error handling. If `initializeSync` throws, the error is swallowed and the user sees no feedback.
- Safe modification: Wrap the `initializeSync` call in try/catch and surface an error state in the onboarding UI.
- Test coverage: Covered in `tests/ui/onboarding.test.ts` but error path for `initializeSync` failure is not tested.

## Scaling Limits

**Manifest hard cap at 10,000 files:**
- Current capacity: Vaults up to 10,000 files sync normally.
- Limit: The server rejects manifests with more than 10,000 entries. The client surfaces a notice and fails the sync with `MANIFEST_TOO_LARGE`.
- Scaling path: The 10,000 limit is server-enforced. Client-side improvement would be to auto-suggest exclude patterns based on file type distribution (e.g., "You have 3,000 image files — exclude `*.png`?").

**In-memory hash cache has no upper bound:**
- Current capacity: `FileHasher.hashCache` grows to one entry per unique file ever seen in the vault session, with no eviction.
- Limit: For a 50,000-file vault, the cache holds 50,000 entries. Each entry is approximately 100 bytes (64-char hash string + path string + mtime number), totaling roughly 5MB — unlikely to be a practical issue.
- Scaling path: If memory pressure becomes an issue, add LRU eviction with a configurable cap.

## Test Coverage Gaps

**`ChatClient` streaming path (Node `https` transport):**
- What's not tested: The `sendMessageStreaming()` method in `src/chat-client.ts` is only reachable when `globalThis.require('https')` succeeds (desktop Electron). All existing tests use the `requestUrl` fallback path.
- Files: `src/chat-client.ts` (lines 233-369), `tests/chat-client.test.ts`
- Risk: SSE parsing bugs, abort handling, and tool event callbacks in the streaming path could regress undetected.
- Priority: High — this is the primary chat path on desktop.

**`onunload()` / resource cleanup:**
- What's not tested: `LumenPlugin.onunload()` calls `stopBackgroundPoll`, `stopIndexingPoll`, `syncStatusBar.destroy()`, `syncManager.destroy()`, and `networkStatus.destroy()`. No test verifies that all timers and listeners are cleaned up on unload.
- Files: `src/main.ts` (lines 412-420)
- Risk: Memory leaks or duplicate event listeners if the plugin is reloaded (e.g., during development with hot-reload or after settings changes that re-initialize sync).
- Priority: Medium.

**`resolveConflict()` / `resolveAllConflicts()` in main.ts:**
- What's not tested: The conflict resolution methods on `LumenPlugin` that manipulate vault files and update the `unresolvedConflicts` array.
- Files: `src/main.ts` (lines 137-173)
- Risk: File operation errors (vault.read fails, vault.delete fails) could leave `unresolvedConflicts` in an inconsistent state.
- Priority: Medium.

**React UI components (ChatView, SearchView, OnboardingView):**
- What's not tested: `src/ui/components/chat/ChatView.tsx`, `src/ui/components/search/SearchView.tsx`. The `openDocument()` fallback logic, the scroll throttle behavior, and the `highlightTerms()` function have no test coverage.
- Files: `src/ui/components/search/SearchView.tsx`, `src/ui/components/chat/ChatView.tsx`
- Risk: Document-open path normalization (`stripWorkspacePrefix`) and `.md` extension matching could silently break if path formats change.
- Priority: Low — UI logic is hard to test in jsdom, but the path normalization logic could be extracted and unit tested separately.

## Dependencies at Risk

**Obsidian internal API: `app.setting.openTabById()`:**
- Risk: Used in `ErrorState.tsx` and `SearchView.tsx` via `(app as any).setting` to programmatically open the settings tab. This is an undocumented Obsidian internal that could be removed or renamed in any Obsidian release.
- Impact: "Open Settings" buttons in search and error states stop working.
- Migration plan: No typed alternative exists. Add an Obsidian version check or monitor the Obsidian changelog for breaking changes to the settings API.

**`globalThis.require` for Node module access:**
- Risk: `ChatClient` uses `(globalThis as any).require` to load the Node `https`/`http` module at runtime. This depends on Electron's specific module resolution behavior and could break if Obsidian adopts a stricter Electron CSP or moves to a different renderer architecture.
- Impact: SSE streaming falls back to the non-streaming `requestUrl` path — degraded but functional.
- Migration plan: Monitor Obsidian's Electron version upgrades. The non-streaming fallback provides resilience.

---

*Concerns audit: 2026-03-11*
