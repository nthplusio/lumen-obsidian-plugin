# Testing Patterns

**Analysis Date:** 2026-03-11

## Test Framework

**Runner:**
- Vitest 2.x
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest built-in (`expect`) — no separate assertion library

**Run Commands:**
```bash
npm test                # Vitest watch mode
npm run test:run        # Single run (CI mode)
npm run test:coverage   # Coverage with v8 provider
npx vitest run tests/sync/file-hasher.test.ts   # Single file
npx vitest run -t "pattern matching"            # Pattern match
```

## Test File Organization

**Location:**
- All tests live in `tests/` (separate from `src/`) — not co-located
- Integration tests in `tests/integration/`
- UI hook/component tests in `tests/ui/`
- Sync subsystem tests in `tests/sync/`
- Utility tests in `tests/utils/`

**Naming:**
- Files mirror source path with `.test.ts` suffix: `src/utils/logger.ts` → `tests/utils/logger.test.ts`
- Integration test files named by scenario or feature: `sync-flow.test.ts`, `v1.3-features.test.ts`

**Structure:**
```
tests/
├── __mocks__/
│   └── obsidian.ts          # Minimal Obsidian API stubs
├── integration/
│   ├── sync-flow.test.ts    # Full pipeline integration tests
│   ├── v1.3-features.test.ts
│   └── v13-features.test.ts
├── sync/
│   ├── conflict-logger.test.ts
│   ├── file-hasher.test.ts
│   ├── handle-server-changes.test.ts
│   ├── sync-client.test.ts
│   ├── sync-manager.test.ts
│   └── sync-manager-v2.test.ts
├── ui/
│   ├── onboarding.test.ts
│   ├── phase4-features.test.ts
│   ├── quick-search.test.ts
│   ├── useChat.test.ts
│   └── useSearch.test.ts
└── utils/
    ├── error-classifier.test.ts
    ├── logger.test.ts
    └── sse-parser.test.ts
```

## Test Structure

**Suite Organization:**

Top-level `describe` matches the class or module under test. Nested `describe` groups test behaviors or methods:
```typescript
describe('FileHasher', () => {
    let vault: ReturnType<typeof createMockVault>;
    let settings: LumenSettings;
    let hasher: FileHasher;

    beforeEach(() => {
        vi.clearAllMocks();
        vault = createMockVault();
        settings = createSettings();
        hasher = new FileHasher(vault as any, settings);
    });

    describe('hashFile', () => {
        it('returns correct SHA-256 hex string', async () => { ... });
        it('handles empty file content', async () => { ... });
    });

    describe('hashFile caching', () => {
        it('uses cache on mtime match (does not re-read file)', async () => { ... });
    });

    describe('hashAllFiles', () => { ... });
});
```

**Error classifier tests use flat `describe` per category (no shared beforeEach):**
```typescript
describe('classifyError — auth errors', () => {
    it('classifies 401 status as auth error', () => { ... });
    it('classifies "Unauthorized" message as auth error', () => { ... });
});

describe('classifyError — validation errors', () => { ... });
describe('classifyError — network errors', () => { ... });
```

**Patterns:**
- `beforeEach`: `vi.clearAllMocks()` + fresh instance creation (avoids state leakage)
- `afterEach`: `vi.restoreAllMocks()` (used when spying on console methods)
- `globals: true` in vitest config — no explicit import of `describe`, `it`, `expect` required, but most test files import explicitly anyway

## Mocking

**Framework:** Vitest `vi` — `vi.fn()`, `vi.mock()`, `vi.hoisted()`, `vi.spyOn()`

**Two approaches for mocking `obsidian`:**

1. **Global mock file** (`tests/__mocks__/obsidian.ts`) — aliased in `vitest.config.ts` for tests that import from source files that use Obsidian types. Contains minimal stubs: `Plugin`, `Vault`, `TFile`, `Modal`, `Notice`, `requestUrl`, `MarkdownRenderer`.

2. **Inline `vi.mock()`** — used when a test needs finer control (e.g., to spy on `Notice` or mock `requestUrl` per-test):
```typescript
const mockRequestUrl = vi.hoisted(() => vi.fn());

vi.mock('obsidian', () => ({
    requestUrl: mockRequestUrl,
    Plugin: class {},
    Notice: class {},
    TFile: class TFile { path = ''; extension = 'md'; stat = { mtime: 0, size: 0 }; },
    normalizePath: (p: string) => p,
    Platform: { isDesktop: true, isMobile: false },
}));
```

**`vi.hoisted()`** used to declare mock factories that are referenced inside `vi.mock()` callbacks (avoids temporal dead zone issues with `const`).

**Factory functions** create mock objects with `vi.fn()`:
```typescript
function createMockVault() {
    return {
        read: vi.fn().mockResolvedValue('# Hello World\n\nContent here.'),
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        getFiles: vi.fn().mockReturnValue([]),
        on: vi.fn(),
        off: vi.fn(),
    };
}

function createMockSyncClient() {
    return {
        register: vi.fn(),
        sendManifestV2: vi.fn().mockResolvedValue(createDefaultV2Response()),
        uploadFiles: vi.fn().mockResolvedValue({ accepted: 0, rejected: 0, ... }),
        downloadFiles: vi.fn().mockResolvedValue({ files: [] }),
    };
}
```

**What to mock:**
- `obsidian` API (Vault, TFile, Notice, requestUrl, Platform)
- HTTP clients (`SyncClient`, `ApiClient`) in integration tests
- `ConflictLogger` in `SyncManager` tests
- `console.log/warn/error` when testing logger output (`vi.spyOn(console, 'log').mockImplementation(() => {})`)

**What NOT to mock:**
- Pure utility functions under test (`classifyError`, `isExcludedByPatterns`, `parseSSEBuffer`)
- Node crypto (imported directly in test helpers via `import('node:crypto')`)

## Fixtures and Factories

**Test Data Factory Pattern:**

Settings factories use `DEFAULT_SETTINGS` spread + overrides:
```typescript
function createSettings(overrides: Partial<LumenSettings> = {}): LumenSettings {
    return { ...DEFAULT_SETTINGS, ...overrides };
}
```

File object factories for TFile-like objects:
```typescript
function createMockFile(path: string, mtime = 1000, size = 100) {
    return {
        path,
        name: path.split('/').pop()!,
        basename: path.split('/').pop()!.replace('.md', ''),
        extension: 'md',
        stat: { mtime, ctime: mtime, size },
        vault: {} as any,
        parent: null,
    };
}
```

Response factories for API responses:
```typescript
function createDefaultV2Response(overrides: Partial<SyncManifestResponseV2> = {}): SyncManifestResponseV2 {
    return {
        sync_session_id: 'session-001',
        needed_files: [],
        deleted_files: [],
        new_cursor: 'cursor-new',
        ...overrides,
    };
}
```

**Location:**
- Factory functions defined at the top of each test file (not shared across files)
- No shared fixture directory

## Coverage

**Provider:** `@vitest/coverage-v8`

**Targets:** No minimum enforced

**Excluded from coverage:**
- `src/main.ts` — plugin entry point, heavy Obsidian lifecycle dependencies
- `src/settings-tab.ts` — Obsidian settings UI, untestable without full Obsidian runtime

**View Coverage:**
```bash
npm run test:coverage
# Coverage report written to coverage/
```

## Test Types

**Unit Tests:**
- Scope: Pure functions and class logic with mocked dependencies
- Focus: `FileHasher` hashing/caching, `classifyError` all branches, `Logger` ring buffer + redaction, `parseSSEBuffer` / `parseConversationSSE` parsing, `isExcludedByPatterns` glob matching
- Files: `tests/utils/`, `tests/sync/file-hasher.test.ts`, `tests/sync/conflict-logger.test.ts`

**Integration Tests:**
- Scope: Real `SyncManager` + real `FileHasher` wired together, with mocked `SyncClient`, `Vault`, `ConflictLogger`
- Tests full state machine flow: `idle → hashing → manifest → uploading → success`
- Files: `tests/integration/sync-flow.test.ts`, `tests/integration/v1.3-features.test.ts`

**Structural / Source-Inspection Tests:**
- Some UI hook tests (`tests/ui/useChat.test.ts`, `tests/ui/useSearch.test.ts`) use `readFileSync` to assert that specific constants and patterns exist in source files when the hook can't be rendered without a full React environment:
```typescript
it('300ms debounce constant matches spec', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync('src/ui/hooks/useSearch.ts', 'utf-8');
    expect(content).toContain('const DEBOUNCE_MS = 300');
});
```

**E2E Tests:** Not used.

## Common Patterns

**Async Testing:**
```typescript
it('returns correct SHA-256 hex string', async () => {
    const content = '# Hello World\n\nContent here.';
    vault.read.mockResolvedValue(content);

    const file = createMockFile('notes/test.md');
    const hash = await hasher.hashFile(file as any);

    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
});
```

**Error Testing:**
```typescript
it('handles file read errors gracefully (skips bad files)', async () => {
    vault.read
        .mockResolvedValueOnce('good content')
        .mockRejectedValueOnce(new Error('Permission denied'))
        .mockResolvedValueOnce('also good content');

    const result = await hasher.hashAllFiles();
    expect(result.size).toBe(2);
    expect(result.has('notes/bad.md')).toBe(false);
});
```

**State machine transition testing (SyncManager):**
```typescript
const stateChanges: SyncState[] = [];
manager = new SyncManager(settings, fileHasher, syncClient, conflictLogger, mockPlugin.plugin, (state) => {
    stateChanges.push(state);
});
await manager.syncNow();
expect(stateChanges).toEqual(['hashing', 'manifest', 'uploading', 'success', 'idle']);
```

**Counting mock call arguments:**
```typescript
expect(vault.read).toHaveBeenCalledTimes(1); // NOT called again (cache hit)
expect(vault.read).toHaveBeenCalledTimes(2); // Re-read on mtime change
```

**Suppressing console in tests:**
```typescript
beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
});
```

**Fake timers** used in `SyncManager` tests for debounce testing:
```typescript
vi.useFakeTimers();
// ... trigger debounce
vi.advanceTimersByTime(60_000);
vi.useRealTimers();
```

---

*Testing analysis: 2026-03-11*
