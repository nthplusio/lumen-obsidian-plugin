---
team: plan-roadmap-plugin-ux
task: 2
author: resilience-engineer
status: complete
created: 2026-02-25
---

# Task 2: Resilience Audit — Sync, Error Handling, Logging, and Chat

## Executive Summary

The Lumen plugin has solid foundations — error classification, retry logic, API key redaction, and a state machine for sync. However, several gaps exist that would cause problems for marketplace users: no offline detection, no partial sync recovery, the chat cancel button doesn't actually abort the HTTP request, and logging gaps make debugging user issues difficult.

## Sync Subsystem Audit

### State Machine

Current states: `idle → hashing → manifest → uploading → downloading → success → idle` (with `error` reachable from any state).

**Findings:**

1. **GAP: No offline detection.** If the device loses network mid-sync, the `requestUrl` call will eventually timeout and be classified as a network error. But there's no proactive offline detection — the plugin will keep attempting syncs (via debounce timer and auto-sync interval) even when the device is known-offline.

   **Recommendation:** Add `navigator.onLine` checks before starting sync. Register `online`/`offline` event listeners. When offline, pause auto-sync and show "Offline" in status bar. When back online, trigger immediate sync.

2. **GAP: No partial sync recovery.** If the upload phase fails at batch 3 of 10, the entire sync is marked as failed. On retry, it re-hashes everything and re-sends the full manifest. The server will de-duplicate files already uploaded (via `deduplicated` count), but the client still reads and uploads all files in batches 4-10 again.

   **Recommendation:** Track `lastSuccessfulBatchIndex` in sync state. On retry, skip already-uploaded batches. The server already supports this (it tracks the sync session).

3. **GAP: Sync session expiry not handled gracefully.** Server returns 410 for expired sessions (`SYNC_SESSION_EXPIRED`). The error classifier marks this as non-retryable. But the fix is simple: start a new sync. The user must manually click retry.

   **Recommendation:** Auto-restart sync on 410 (new manifest exchange, new session).

4. **GOOD: Visibility-gated sync.** `visibilitychange` listener pauses debounce when tab hidden, resumes on foreground. Prevents background resource waste.

5. **GOOD: File count guard.** Manifest capped at 10,000 files with clear user message.

6. **GAP: `requires_full_sync` from server not clearly communicated.** When the server sets this flag, the plugin does a full sync. But there's no UI feedback telling the user this is happening or why.

   **Recommendation:** Add a Notice: "Server requested full re-sync. This may take longer."

### File Hashing

7. **GOOD: Chunked processing.** 50 files per chunk with 10ms yield — keeps UI responsive.

8. **GOOD: mtime-based cache.** Skips unchanged files efficiently.

9. **GAP: Mobile large vault warning threshold.** `MOBILE_LARGE_VAULT_THRESHOLD = 5000` triggers a Notice, but it's a one-time warning with no way to see progress or cancel.

   **Recommendation:** Add a progress modal for hashing on mobile when >5000 files, with a cancel button.

### Upload Logic

10. **GOOD: Batched uploads** with per-batch retry (exponential backoff, max 3 retries).

11. **GOOD: ETA calculation** based on rolling average of last 5 batch durations.

12. **GAP: No upload cancellation.** If the user wants to cancel a long upload, there's no mechanism. The sync runs to completion or failure.

    **Recommendation:** Add `AbortController` support to upload requests. Wire to a "Cancel Sync" button in status bar.

### Download Logic

13. **GOOD: Hash verification on download.** Each downloaded file's SHA-256 is verified against `content_hash`. Mismatches are skipped with a Notice.

14. **GOOD: Path safety validation.** `isSafePath()` prevents directory traversal attacks.

15. **GAP: Binary file round-trip.** `atob` + `charCodeAt` for base64 decoding may fail for very large files (stack overflow on `Uint8Array.from`).

    **Recommendation:** Use `Uint8Array` from `atob` in chunks, or use a proper base64 decoder for large files.

### Conflict Handling

16. **ISSUE: Server always wins.** All conflicts resolve to `server-kept`. The user sees a notice and entries in `.lumen-conflicts.md`, but has no way to choose "keep local" for individual files.

    **Recommendation (Phase 2+):** Add a conflict resolution modal showing diff previews. Short-term: ensure the conflict log includes enough context for manual recovery.

17. **GOOD: Conflict content pre-read.** BUG-1 fix correctly reads local content before downloading server versions.

## Error Handling Audit

### Error Classifier

18. **GOOD: Comprehensive categories.** 8 categories: network, auth, server, timeout, validation, rate-limit, config, unknown.

19. **GAP: String matching is fragile.** Error classification relies on `msg.includes('401')` etc. If Obsidian or the server changes error message formats, classification breaks silently.

    **Recommendation:** Also check `httpErr.status` property directly (the requestUrl error object has it). Use status code as primary classifier, message patterns as fallback.

20. **GAP: No distinction between transient and permanent network errors.** `ECONNREFUSED` is marked retryable, but `ENOTFOUND` is not. In practice, DNS issues can be transient (e.g., switching between WiFi and cellular).

    **Recommendation:** Make `ENOTFOUND` retryable with a longer backoff.

### Retry Logic

21. **GOOD: Exponential backoff.** Sync: 1s, 2s, 4s. Batch uploads: configurable via constants.

22. **GAP: No jitter in backoff.** Multiple devices syncing simultaneously will retry in lockstep.

    **Recommendation:** Add random jitter: `delay * (0.5 + Math.random())`.

23. **GAP: Search retries use fixed delay.** `RETRY_DELAY_MS * (retryCount + 1)` = 1s, 2s. Not exponential.

    **Recommendation:** Use exponential backoff for search retries too.

## Chat Audit

### Known Issue: Chat Not Working

24. **CRITICAL: Chat reported as broken in latest build.** Based on code analysis, likely causes:

    a. **`requestUrl` buffers the entire SSE response.** The chat uses `requestUrl` which waits for the complete response before returning. For long AI responses, this could timeout (Obsidian's default timeout for `requestUrl` is not configurable per-call). If the server takes >30s to generate, the request may silently fail.

    b. **No timeout handling in `sendMessage`.** The `ChatClient.sendMessage()` method has no timeout. It awaits `requestUrl()` which could hang indefinitely for streaming endpoints.

    c. **SSE parsing edge case.** `parseConversationSSE` splits on `\n\n` but the buffered response may not have clean double-newline separators if the server sends data before headers complete.

    **Recommendation:**
    - Investigate if `requestUrl` timeout is the issue (add logging around the call).
    - Consider switching chat to native `fetch` with `ReadableStream` for true streaming (like upload already uses `fetch` for FormData). This would give real-time tokens instead of buffered replay.
    - Add explicit timeout with `AbortController`.

25. **GAP: Chat cancel doesn't abort the request.** `cancelChat()` sets `this.chatCancelled = true` but doesn't abort the underlying HTTP request. The request continues consuming server resources and bandwidth.

    **Recommendation:** Use `AbortController` to actually abort the `requestUrl` or `fetch` call.

26. **GAP: No chat message history persistence.** When switching conversations, messages are cleared. When switching back, only the empty state shows. The user must re-fetch message history from the server.

    **Recommendation:** Load conversation messages from server when switching to an existing conversation (the API likely supports `GET /conversations/:id/messages`).

27. **GAP: No typing indicator for long responses.** The loading dots appear until the first token, then disappear. For `requestUrl`-buffered responses, the user sees loading dots for the entire generation time (could be 30s+), then all text appears at once.

    **Recommendation:** If staying with `requestUrl`, add a "Generating..." status with elapsed time. If switching to `fetch` streaming, show real-time tokens.

### Chat Error Handling

28. **GOOD: Typed error handling.** `PlanUpgradeRequiredError` and `RateLimitExceededError` are properly caught and surfaced.

29. **GAP: Generic errors lose context.** The catch block in `sendChatMessage` logs `errMsg` but doesn't classify the error. Network vs server vs timeout errors all show the same generic message.

    **Recommendation:** Use `classifyError()` for chat errors too (it's already imported but not used in the catch block).

## Logging Audit

### Logger

30. **GOOD: Ring buffer** (500 entries, FIFO eviction). Efficient memory usage.

31. **GOOD: API key redaction.** Three patterns: auth headers, bearer tokens, `vr_*` keys.

32. **GOOD: Real-time listener API** for debug log viewer.

33. **GAP: `info()` only logs to console when `debugMode` is true.** This means sync progress, connection status, and other useful info is invisible unless the user manually enables debug mode in settings.

    **Recommendation:** Consider logging `info` to console always (or have a "verbose" mode separate from debug). Keep buffer writes unconditional (as they are now).

34. **GAP: No structured logging.** All log entries are stringified. Makes it hard to filter or search in the debug log viewer.

    **Recommendation:** Add optional structured metadata to `LogEntry` (e.g., `{ component: 'sync', phase: 'upload', batchIndex: 3 }`).

35. **GAP: No log export.** Users can't export the debug log for bug reports.

    **Recommendation:** Add "Copy to Clipboard" and "Save to File" buttons in the debug log view.

36. **GAP: No performance metrics.** Sync duration, hash rate, upload speed are logged as strings but not tracked as metrics.

    **Recommendation:** Add a `metrics` object to the logger or SyncManager for timing data.

## Prioritized Recommendations

### P0 — Critical (Fix before marketplace release)

1. **Investigate and fix chat** — Likely `requestUrl` timeout or SSE parsing issue
2. **Add offline detection** — `navigator.onLine` + event listeners
3. **Add sync cancellation** — `AbortController` on upload requests
4. **Fix chat cancel** — Actually abort the HTTP request

### P1 — High Priority (First release quality)

5. **Improve error classification** — Use HTTP status codes primarily
6. **Add jitter to retry backoff** — Prevent thundering herd
7. **Auto-restart on 410** — Expired sync session recovery
8. **Add log export** — Critical for user bug reports
9. **Classify chat errors** — Use existing `classifyError()` in chat catch block

### P2 — Medium Priority (Post-release improvement)

10. **Partial sync recovery** — Track last successful batch
11. **True streaming for chat** — Switch from `requestUrl` to `fetch` + `ReadableStream`
12. **Structured logging** — Component metadata on log entries
13. **Performance metrics** — Track and display sync performance
14. **Full sync notification** — Tell user when server requests full re-sync

### P3 — Low Priority (Future enhancement)

15. **Conflict resolution UI** — Let user choose local vs server per file
16. **Chat message history** — Load messages when switching conversations
17. **Hashing progress modal** — For mobile with large vaults
18. **Network-aware retry** — Different strategies for WiFi vs cellular
