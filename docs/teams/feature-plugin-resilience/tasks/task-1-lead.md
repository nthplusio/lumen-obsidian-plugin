---
team: feature-plugin-resilience
task: 1
author: lead
status: complete
created: 2026-02-25
---

# Task 1: API Contracts for Phase 0 + Phase 1

## User-Approved Decisions (2026-02-25)

1. **No backward compatibility concerns** — Pre-launch plugin, breaking changes are fine.
2. **SyncClient: switch to `fetch`** — Use `fetch` with `AbortSignal` for sync JSON endpoints too (not just uploads). Only fall back to `requestUrl` + `Promise.race` if `fetch` has CORS issues in Electron.
3. **410 restart resets both** — Clear `lastSyncCursor` AND `lastSyncSeq` to 0 for full fresh start.
4. **`signal` parameter** — Can be required or restructured freely. No need to preserve old signatures.

## 1. NetworkStatus Singleton (`src/utils/network-status.ts` — new file)

```typescript
type NetworkCallback = (online: boolean) => void;

class NetworkStatus {
  private listeners: Set<NetworkCallback>;
  private _online: boolean;
  private onlineHandler: () => void;
  private offlineHandler: () => void;

  constructor();

  /** Current connectivity state */
  get online(): boolean;

  /**
   * Subscribe to connectivity changes.
   * @returns Unsubscribe function
   */
  onChange(cb: NetworkCallback): () => void;

  /**
   * Clean up window event listeners. Call from plugin onunload().
   */
  destroy(): void;
}

/** Singleton instance — import this */
export const networkStatus: NetworkStatus;
```

**Integration points:**
- `SyncManager.executeSync()` — check `networkStatus.online` before starting; return early with offline error
- `SyncManager.initialize()` — register `networkStatus.onChange()` to trigger sync when coming back online
- `SyncManager.destroy()` — unsubscribe from networkStatus
- `SyncStatusBar` — subscribe to `networkStatus.onChange()`, show "Offline" with `wifi-off` icon
- `main.ts` — call `networkStatus.destroy()` in `onunload()`

---

## 2. ChatClient Streaming (`src/chat-client.ts`)

### New method: `sendMessageStream()`

Replace `sendMessage()` internals with streaming. Keep the same public signature but switch transport from `requestUrl` (buffered) to `fetch` + `ReadableStream` (incremental).

```typescript
/**
 * Send a message with real-time SSE streaming via native fetch.
 *
 * @param conversationId - Conversation to send to
 * @param message - User's message text
 * @param options.deepResearch - Enable deep research mode
 * @param options.onToken - Called for each content token AS IT ARRIVES (real-time)
 * @param options.signal - AbortSignal for cancellation
 * @returns Complete response with content, sources, metadata
 * @throws PlanUpgradeRequiredError on 403 plan_upgrade_required
 * @throws RateLimitExceededError on 429
 * @throws Error on network/server failures
 */
async sendMessage(
  conversationId: string,
  message: string,
  options: {
    deepResearch?: boolean;
    onToken?: (token: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<ChatStreamResult>;
```

**Implementation approach:**
- Use native `fetch()` with `signal` from AbortController
- Read response via `response.body.getReader()` + `TextDecoder({ stream: true })`
- Parse SSE events incrementally using a new `parseSSEChunk()` helper (see below)
- Accumulate tokens, call `onToken` as each arrives
- Collect sources and metadata from `lumen_metadata` event
- Handle HTTP errors from `response.ok` / `response.status` before reading body
- **Fallback**: If `fetch` fails with CORS in Electron, detect and fall back to `requestUrl` with timeout wrapper

### New error handler: `handleFetchError()`

```typescript
/**
 * Parse HTTP error response from native fetch and throw typed errors.
 * Mirrors handleHttpError() but works with Response object instead of requestUrl error.
 */
private async handleFetchError(response: Response): Promise<never>;
```

Parses response body as JSON, checks for `plan_upgrade_required` (403) and `rate_limit_exceeded` (429), throws appropriate typed errors.

---

## 3. Incremental SSE Parser (`src/utils/sse-parser.ts`)

### New function: `parseSSEChunk()`

```typescript
/**
 * Parse a chunk of SSE data incrementally.
 * Splits on double-newline boundaries, returns parsed events and remaining buffer.
 *
 * @param buffer - Accumulated SSE text (may contain incomplete events)
 * @returns { events: SSEEvent[], remaining: string }
 */
export function parseSSEChunk(buffer: string): {
  events: ParsedSSEEvent[];
  remaining: string;
};

/** Single parsed SSE event */
export interface ParsedSSEEvent {
  /** Token text (from content_block_delta) */
  token?: string;
  /** Sources (from lumen_metadata) */
  sources?: ChatSource[];
  /** Full metadata (from lumen_metadata) */
  metadata?: StreamMetadata;
  /** Error message (from error event) */
  error?: string;
}
```

**Logic:** Split buffer on `\n\n`, keep last incomplete chunk as `remaining`. For each complete event block, parse event type and data JSON. Return structured events.

---

## 4. AbortController in SyncManager (`src/sync/sync-manager.ts`)

### New property and method:

```typescript
class SyncManager {
  /** Active sync abort controller — null when no sync in progress */
  private syncAbortController: AbortController | null = null;

  /**
   * Cancel an in-progress sync.
   * Aborts pending HTTP requests and resets state to idle.
   */
  cancelSync(): void;
}
```

### Signal threading:

The `syncAbortController.signal` is passed through to:
1. `SyncClient.uploadFiles()` — new optional `signal?: AbortSignal` parameter
2. `SyncClient.downloadFiles()` — new optional `signal?: AbortSignal` parameter
3. `SyncClient.sendManifestV2()` — new optional `signal?: AbortSignal` parameter

In `executeSync()`:
- Create `this.syncAbortController = new AbortController()` at start
- Check `this.syncAbortController.signal.aborted` between phases
- In `finally` block: `this.syncAbortController = null`
- In `catch` block: detect `AbortError` and return clean cancelled result (not error state)

### SyncClient signal parameter additions:

```typescript
class SyncClient {
  async sendManifestV2(
    entries: FileManifestEntry[],
    deviceId: string,
    lastSyncSeq: number,
    cursor?: string,
    signal?: AbortSignal,  // NEW
  ): Promise<SyncManifestResponseV2>;

  async uploadFiles(
    syncSessionId: string,
    files: Array<{ path: string; content: string }>,
    batchIndex: number,
    isLastBatch: boolean,
    signal?: AbortSignal,  // NEW
  ): Promise<SyncUploadResponse>;

  async downloadFiles(
    syncSessionId: string,
    paths: string[],
    downloadEndpoint: string,
    signal?: AbortSignal,  // NEW
  ): Promise<SyncDownloadResponse>;
}
```

For `requestUrl`-based methods: wrap in `Promise.race` with abort signal since `requestUrl` doesn't natively support `AbortSignal`. For `fetch`-based methods (uploadFiles): pass `signal` directly to `fetch()`.

---

## 5. Chat Cancel via AbortController (`src/main-view.ts`)

### Changes to LumenMainView:

```typescript
class LumenMainView {
  /** AbortController for the current chat request */
  private chatAbortController: AbortController | null = null;

  /** Cancel ongoing chat — aborts the HTTP request */
  private cancelChat(): void {
    this.chatCancelled = true;
    this.chatAbortController?.abort();
    this.chatAbortController = null;
  }
}
```

In `sendChatMessage()`:
- Create `this.chatAbortController = new AbortController()` before the fetch
- Pass `signal: this.chatAbortController.signal` to `chatClient.sendMessage()`
- In `finally`: `this.chatAbortController = null`
- In `catch`: detect `AbortError` (from `err.name === 'AbortError'`) and show "Message cancelled" instead of error

---

## 6. SyncStatusBar Updates (`src/sync/sync-status-bar.ts`)

### New offline state:

```typescript
class SyncStatusBar {
  /** Show offline indicator */
  showOffline(): void;

  /** Show cancel button during active sync */
  showCancelButton(onCancel: () => void): void;

  /** Hide cancel button */
  hideCancelButton(): void;
}
```

`showOffline()` sets icon to `wifi-off`, text to "Offline", CSS class to `lumen-sync-offline`.

Cancel button: small `x-circle` icon appended next to sync progress text, 44x44px touch target, calls `onCancel` callback.

---

## 7. Error Classifier Improvements (Phase 1) (`src/utils/error-classifier.ts`)

### Refactored `classifyError()`:

```typescript
/**
 * Classify an unknown error. Priority:
 * 1. HTTP status code (from requestUrl error object { status, text })
 * 2. HTTP status code (from fetch Response-derived errors)
 * 3. Error message pattern matching (fallback)
 */
export function classifyError(err: unknown): ClassifiedError;

/** Classify by HTTP status code — primary path */
function classifyByStatusCode(status: number, body?: Record<string, unknown>): ClassifiedError;

/** Classify by error message patterns — fallback path */
function classifyByMessage(message: string): ClassifiedError;
```

The `classifyError` entry point checks for:
1. `err` with numeric `.status` property (requestUrl errors)
2. `err` with `.statusCode` property (custom errors)
3. `err instanceof Error` — delegate to `classifyByMessage()`

### ENOTFOUND change:

```typescript
// ENOTFOUND becomes retryable (DNS can be transient)
{ category: 'network', message: 'Server not found. Retrying...', retryable: true }
```

---

## 8. Retry Jitter (Phase 1) (`src/sync/sync-manager.ts`)

### Jitter formula:

```typescript
/** Calculate jittered delay for exponential backoff */
function jitteredDelay(baseMs: number, retryCount: number): number {
  const exponential = baseMs * Math.pow(2, retryCount);
  return Math.round(exponential * (0.5 + Math.random()));
}
```

Applied in:
- `SyncManager.executeSync()` retry block (currently `1000 * Math.pow(2, retryCount)`)
- `SyncManager.uploadBatchWithRetry()` retry block

---

## 9. 410 Auto-Restart (Phase 1) (`src/sync/sync-manager.ts`)

### In `executeSync()` catch block:

```typescript
// After classifyError(error):
if (classified.statusCode === 410) {
  logger.info('Sync session expired (410), starting fresh sync...');
  this.syncInProgress = false;
  // Clear stale cursor to force fresh manifest
  this.settings.lastSyncCursor = '';
  return this.executeSync(manual, 0); // Fresh attempt, not a retry
}
```

Guard: max 1 auto-restart per sync attempt (prevent infinite loops). Track with a `hasRestarted` flag or pass through parameter.

---

## 10. Log Export — Save to File (Phase 1) (`src/debug-log-view.ts`)

### New button in controls row:

```typescript
// Save to vault file
async saveLogToFile(): Promise<void>;
```

Generates filename `.lumen-debug-YYYY-MM-DDTHH-MM-SS.log`, writes filtered entries to vault via `this.app.vault.create()`. Shows Notice on success/failure.

Note: "Copy to Clipboard" already exists in the current debug-log-view.ts.

---

## Event Flow Diagrams

### Streaming Chat Flow

```
User types message → sendChatMessage()
  ├── Create AbortController
  ├── chatClient.sendMessage(convId, msg, { onToken, signal })
  │     ├── fetch(url, { signal, ... })
  │     ├── reader = response.body.getReader()
  │     ├── LOOP: { done, value } = reader.read()
  │     │     ├── buffer += decoder.decode(value, { stream: true })
  │     │     ├── { events, remaining } = parseSSEChunk(buffer)
  │     │     ├── buffer = remaining
  │     │     └── for each event: onToken(event.token) → UI update
  │     └── Return { content, sources, metadata }
  └── Render markdown, sources, turns info

Cancel: user clicks Stop → cancelChat() → controller.abort()
  → fetch throws AbortError → catch shows "Message cancelled"
```

### Offline Detection Flow

```
Plugin loads → networkStatus singleton created
  ├── Reads navigator.onLine
  ├── Listens: window 'online' / 'offline'
  └── Notifies subscribers on change

SyncManager.initialize() → networkStatus.onChange(online => {
  if (online && pendingChanges.size > 0) scheduleSync()
})

SyncManager.executeSync() → if (!networkStatus.online) return offline error

SyncStatusBar → networkStatus.onChange(online => {
  if (!online) showOffline()
  else update(currentState)
})
```

### Sync Cancellation Flow

```
executeSync() starts → syncAbortController = new AbortController()
  ├── Phase 1: hashing (local, not cancellable)
  ├── Check: signal.aborted? → return cancelled
  ├── Phase 2: manifest → pass signal to sendManifestV2()
  ├── Check: signal.aborted? → return cancelled
  ├── Phase 3: upload batches → pass signal to uploadFiles()
  │     └── Each batch checks signal before starting
  ├── Phase 4: download → pass signal to downloadFiles()
  └── Finally: syncAbortController = null

Cancel: user clicks cancel → syncManager.cancelSync()
  → syncAbortController.abort()
  → HTTP requests throw AbortError
  → catch detects abort → setState('idle'), return clean result
```
