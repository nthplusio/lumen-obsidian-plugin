---
team: plan-roadmap-plugin-ux
task: 6
author: resilience-engineer
status: complete
created: 2026-02-25
---

# Task 6: Detailed Resilience Improvement Plan

## Phase Mapping

Per the approved ordering:
- **Phase 0**: Fix chat + critical resilience (P0 items)
- **Phase 1**: Resilience polish (P1 items)
- Later phases pick up P2/P3 as opportunity allows

## Phase 0: Fix Chat + Critical Resilience (3-5 days)

### 0.1 — Investigate and Fix Chat (1-2 days)

**Root Cause Investigation Plan:**

1. Add diagnostic logging around the `requestUrl` call in `ChatClient.sendMessage()`:
   ```typescript
   logger.info(`Chat → POST ${url} (starting request...)`);
   const startMs = Date.now();
   const response = await requestUrl({ url, method: 'POST', headers: this.headers, body: ... });
   logger.info(`Chat ← response in ${Date.now() - startMs}ms, status: ${response.status}, bytes: ${response.text.length}`);
   ```

2. Test with a short prompt to confirm basic connectivity works.

3. Test with a longer prompt to check if timeout is the issue.

4. If `requestUrl` timeout confirmed: switch to native `fetch` with `ReadableStream`.

**Likely Fix: Switch chat to `fetch` + `ReadableStream`**

`requestUrl` buffers the entire response, which means:
- No real-time streaming (tokens appear all at once after server completes)
- Potential timeout for long responses
- No `AbortController` support

The upload path already uses native `fetch` for FormData. Apply the same pattern for chat:

```typescript
async sendMessageStream(
  conversationId: string,
  message: string,
  options: {
    deepResearch?: boolean;
    onToken?: (token: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<ChatStreamResult> {
  const url = `${this.baseUrl}/api/conversations/${conversationId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: this.headers,
    body: JSON.stringify({ message, deep_research: options.deepResearch ?? false }),
    signal: options.signal,
  });

  if (!response.ok) {
    await this.handleFetchError(response);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  const tokens: string[] = [];
  let sources: ChatSource[] = [];
  let metadata: StreamMetadata | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse complete SSE events from buffer
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? ''; // Keep incomplete last event

    for (const event of events) {
      const parsed = parseSingleSSEEvent(event);
      if (parsed.token) {
        tokens.push(parsed.token);
        options.onToken?.(parsed.token);
      }
      if (parsed.sources) sources = parsed.sources;
      if (parsed.metadata) metadata = parsed.metadata;
    }
  }

  const content = tokens.join('');
  return { content, sources, metadata };
}
```

**Note on CORS**: Native `fetch` may face CORS issues in Obsidian's Electron renderer. Test this. If CORS is an issue, alternatives:
- Use Obsidian's `requestUrl` with a per-request timeout workaround (race with `setTimeout`)
- Use `electron.net.request` (available in desktop Electron)

**Fallback if `fetch` has CORS issues:**

```typescript
// Timeout wrapper for requestUrl
async sendMessageWithTimeout(
  conversationId: string,
  message: string,
  timeoutMs: number = 120_000, // 2 minutes
): Promise<ChatStreamResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // requestUrl doesn't support AbortSignal, so race with a reject
    const result = await Promise.race([
      this.sendMessage(conversationId, message, options),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error('Chat request timed out'));
        });
      }),
    ]);
    return result;
  } finally {
    clearTimeout(timer);
  }
}
```

**Testing checklist:**
- [ ] Short message works (< 5s response)
- [ ] Long message works (30s+ response)
- [ ] Cancel during generation
- [ ] Network disconnect during generation
- [ ] Rate limit response (429)
- [ ] Plan upgrade required response (403)

### 0.2 — Add Offline Detection (0.5 days)

**Implementation:**

Create `src/utils/network-status.ts`:

```typescript
type NetworkCallback = (online: boolean) => void;

class NetworkStatus {
  private listeners = new Set<NetworkCallback>();
  private _online = navigator.onLine;

  constructor() {
    window.addEventListener('online', () => this.setOnline(true));
    window.addEventListener('offline', () => this.setOnline(false));
  }

  get online(): boolean { return this._online; }

  private setOnline(value: boolean): void {
    if (this._online === value) return;
    this._online = value;
    logger.info(`Network: ${value ? 'online' : 'offline'}`);
    for (const cb of this.listeners) cb(value);
  }

  onChange(cb: NetworkCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

export const networkStatus = new NetworkStatus();
```

**Integration points:**
- `SyncManager.executeSync()`: Check `networkStatus.online` before starting. Return early with `'Offline — sync deferred'`.
- `SyncStatusBar`: Subscribe to `networkStatus.onChange()`. Show "Offline" icon when disconnected.
- `SyncManager.initialize()`: Register `networkStatus.onChange()` to trigger sync when coming back online.

### 0.3 — Add Sync Cancellation (0.5 days)

**Implementation:**

Add `AbortController` to `SyncManager`:

```typescript
private syncAbortController: AbortController | null = null;

async executeSync(manual: boolean, retryCount = 0): Promise<SyncResult> {
  // ... existing guards ...
  this.syncAbortController = new AbortController();

  try {
    // Pass signal through to upload calls
    // ... existing sync logic ...
  } finally {
    this.syncAbortController = null;
    this.syncInProgress = false;
  }
}

cancelSync(): void {
  this.syncAbortController?.abort();
  this.setState('idle');
  logger.info('Sync cancelled by user');
}
```

**Status bar integration:**
- When state is `uploading` or `downloading`, show a cancel icon
- Click handler calls `syncManager.cancelSync()`

### 0.4 — Fix Chat Cancel (0.5 days)

Wire `AbortController` into the chat client (see 0.1 above). The `cancel()` function in the UI should call `abortController.abort()`.

In `main-view.ts` (or later in React `useChat`):
```typescript
private chatAbortController: AbortController | null = null;

private cancelChat(): void {
  this.chatCancelled = true;
  this.chatAbortController?.abort();
}
```

## Phase 1: Resilience Polish (3-4 days)

### 1.1 — Improve Error Classification (0.5 days)

**Change:** Check HTTP status code as primary classifier, message patterns as fallback.

```typescript
export function classifyError(err: unknown): ClassifiedError {
  // Check for requestUrl error object with status code
  const httpErr = err as { status?: number; text?: string };
  if (typeof httpErr.status === 'number') {
    return classifyByStatusCode(httpErr.status, httpErr.text);
  }

  // Fall back to message pattern matching (existing logic)
  if (!(err instanceof Error)) {
    return { category: 'unknown', message: 'An unexpected error occurred.', retryable: false };
  }
  return classifyByMessage(err.message);
}

function classifyByStatusCode(status: number, text?: string): ClassifiedError {
  switch (status) {
    case 401: return { category: 'auth', message: 'Invalid or expired API key.', retryable: false, statusCode: 401 };
    case 403: return { category: 'auth', message: 'Access denied.', retryable: false, statusCode: 403 };
    case 404: return { category: 'config', message: 'Endpoint not found.', retryable: false, statusCode: 404 };
    case 410: return { category: 'validation', message: 'Sync session expired.', retryable: false, statusCode: 410 };
    case 413: return { category: 'validation', message: 'File too large.', retryable: false, statusCode: 413 };
    case 422: return { category: 'validation', message: 'Data validation failed.', retryable: true, statusCode: 422 };
    case 429: return { category: 'rate-limit', message: 'Rate limited.', retryable: true, statusCode: 429 };
    default:
      if (status >= 500) return { category: 'server', message: 'Server error.', retryable: true, statusCode: status };
      return { category: 'unknown', message: text?.slice(0, 200) ?? `HTTP ${status}`, retryable: false, statusCode: status };
  }
}
```

**Testing:** Update existing error-classifier tests to cover status code path.

### 1.2 — Add Jitter to Retry Backoff (0.25 days)

**Change:** In `SyncManager.executeSync()` and `uploadBatchWithRetry()`:

```typescript
// Before:
const delayMs = 1000 * Math.pow(2, retryCount);
// After:
const baseDelay = 1000 * Math.pow(2, retryCount);
const delayMs = Math.round(baseDelay * (0.5 + Math.random()));
```

Same pattern in search retries in `main-view.ts`.

### 1.3 — Auto-Restart on 410 (0.5 days)

**Change:** In `SyncManager.executeSync()` catch block, detect 410 and auto-retry with fresh session:

```typescript
if (classified.category === 'validation' && classified.statusCode === 410) {
  logger.info('Sync session expired, starting fresh sync...');
  this.syncInProgress = false;
  // Reset cursor to force fresh manifest exchange
  return this.executeSync(manual, 0); // retryCount=0, fresh attempt
}
```

### 1.4 — Add Log Export (0.5 days)

**Change:** In `debug-log-view.ts`, add two buttons:

```typescript
// Copy to clipboard
const copyBtn = toolbar.createEl('button', { text: 'Copy Log', cls: 'lumen-log-copy-btn' });
copyBtn.addEventListener('click', () => {
  const entries = logger.getEntries();
  const text = entries.map(e => `[${e.timestamp}] [${e.level}] ${e.message}`).join('\n');
  navigator.clipboard.writeText(text);
  new Notice('Debug log copied to clipboard');
});

// Save to file
const saveBtn = toolbar.createEl('button', { text: 'Save Log', cls: 'lumen-log-save-btn' });
saveBtn.addEventListener('click', async () => {
  const entries = logger.getEntries();
  const text = entries.map(e => `[${e.timestamp}] [${e.level}] ${e.message}`).join('\n');
  const path = `.lumen-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  await this.app.vault.create(path, text);
  new Notice(`Debug log saved to ${path}`);
});
```

### 1.5 — Classify Chat Errors (0.25 days)

**Change:** In `main-view.ts` (or React ChatView), replace the generic catch:

```typescript
// Before:
const errMsg = err instanceof Error ? err.message : 'An unexpected error occurred.';
logger.error(`Chat failed: ${errMsg}`);
this.showChatError(errMsg);

// After:
const classified = classifyError(err);
logger.error(`Chat failed (${classified.category}): ${classified.message}`);
if (classified.category === 'network' || classified.category === 'timeout') {
  this.showChatError(`${classified.message} Check your connection and try again.`);
} else if (classified.category === 'auth') {
  this.showChatError(`${classified.message} Check your API key in Settings.`);
} else {
  this.showChatError(classified.message);
}
```

### 1.6 — Make ENOTFOUND Retryable (0.25 days)

**Change:** In `error-classifier.ts`:

```typescript
// Before:
if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
  return { category: 'network', message: 'Server not found.', retryable: false };
}

// After:
if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
  return { category: 'network', message: 'Server not found. Retrying...', retryable: true };
}
```

## Phase 2+ Resilience Items (Tracked, Not Scheduled)

These are captured for future work but not blocking any phase:

| Item | Phase | Effort | Notes |
|------|-------|--------|-------|
| Partial sync recovery | P2 | 1 day | Track `lastSuccessfulBatchIndex`, skip completed batches |
| True streaming for chat | Phase 2 (React migration) | 1 day | Implement alongside React ChatView |
| Structured logging | P2 | 0.5 days | Add `component` field to `LogEntry` |
| Performance metrics | P2 | 1 day | Track sync duration, hash rate, upload speed |
| Full sync notification | P1 | 0.25 days | Notice when `requires_full_sync` is set |
| Conflict resolution UI | Phase 3+ | 3-4 days | Modal with diff preview |
| Chat message history loading | Phase 3+ | 1 day | GET /conversations/:id/messages on switch |
| Mobile hashing progress modal | Phase 3+ | 1 day | Cancel-able progress for large vaults |

## Testing Strategy

### Unit Tests (Vitest)

For each resilience change, add/update tests:

1. **Error classifier**: Test `classifyByStatusCode()` for each HTTP status
2. **Retry jitter**: Test that jittered delays fall within expected range
3. **Network status**: Mock `navigator.onLine` and `window` events
4. **SSE parser**: Test with chunked/incomplete SSE data
5. **Chat timeout**: Test the timeout wrapper races correctly

### Integration Tests

Manual testing checklist for each phase:

**Phase 0:**
- [ ] Chat works with short messages
- [ ] Chat works with long messages (30s+ generation)
- [ ] Chat cancel aborts the request
- [ ] Sync works when online
- [ ] Sync shows "Offline" when disconnected
- [ ] Sync resumes when reconnected
- [ ] Sync can be cancelled mid-upload

**Phase 1:**
- [ ] Error messages are user-friendly for each error type
- [ ] Retries have visible jitter (check logs)
- [ ] 410 error auto-restarts sync
- [ ] Debug log can be copied to clipboard
- [ ] Debug log can be saved to file
- [ ] Chat errors show appropriate context (network vs auth vs generic)

## Dependencies on Other Phases

- **Phase 0 must complete before Phase 2** (React migration). The chat fix establishes the streaming pattern that React will wrap.
- **Phase 1 can overlap with Phase 2** (resilience polish items are independent of UI framework).
- **True streaming for chat** should be done during Phase 2 (React migration) since the React `useChat` hook is the natural place for `ReadableStream` integration.
