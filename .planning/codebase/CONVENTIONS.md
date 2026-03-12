# Coding Conventions

**Analysis Date:** 2026-03-11

## Naming Patterns

**Files:**
- TypeScript source files use `kebab-case`: `file-hasher.ts`, `sync-client.ts`, `error-classifier.ts`
- React component files use `PascalCase`: `ChatView.tsx`, `ErrorBoundary.tsx`, `SearchView.tsx`
- React hooks use `camelCase` with `use` prefix: `useChat.ts`, `useSearch.ts`, `useSyncState.ts`
- Test files mirror source with `.test.ts` suffix: `file-hasher.test.ts`, `error-classifier.test.ts`
- Index files exist only for barrel exports: `src/ui/components/shared/index.ts`

**Classes:**
- PascalCase: `FileHasher`, `SyncManager`, `SyncClient`, `ApiClient`, `LumenHttpClient`
- Abstract base classes prefixed with category: `LumenHttpClient` (abstract base)

**Functions:**
- camelCase for exported functions: `classifyError()`, `isExcludedByPatterns()`, `isConflictFile()`
- camelCase for private class methods: `yieldToUI()`, `addEntry()`, `formatArgs()`
- Private helper functions in module scope are camelCase with no export: `extractServerDetail()`, `classifyByStatusCode()`, `classifyByMessage()`

**Variables / Constants:**
- Module-level constants use SCREAMING_SNAKE_CASE: `CHUNK_SIZE`, `MAX_ENTRIES`, `DEBOUNCE_MS`, `LUMEN_API_URL`
- Underscore numeric separators used for large numbers: `60_000`, `1_000`, `8_000`
- Local variables use camelCase

**Types and Interfaces:**
- Interfaces use PascalCase: `LumenSettings`, `ClassifiedError`, `LogEntry`, `CachedHash`
- Type aliases use PascalCase: `SyncState`, `ErrorCategory`, `LogLevel`, `PlanTier`
- Discriminated union members use single-quoted string literals: `'idle' | 'hashing' | 'manifest'`
- Error classes extend `Error`, set `this.name` in constructor: `WorkspaceConfirmationError`, `PlanUpgradeRequiredError`

**React:**
- Component functions are named exports using PascalCase: `export function ChatView()`
- Context providers follow `[Name]Provider` / `use[Name]` pair pattern: `PluginProvider` / `usePlugin()`
- Reducer action types use SCREAMING_SNAKE_CASE strings: `'ADD_USER_MESSAGE'`, `'SET_ERROR'`, `'STREAM_TOKEN'`
- Internal state types defined in same file as hook: `ChatState`, `ChatAction`, `ChatStatus`

## Code Style

**Formatting:**
- Tabs for indentation (esbuild config and TypeScript source both use tabs)
- No linter configured in this workspace — lint runs from monorepo root

**TypeScript Strictness:**
- `noImplicitAny: true`
- `strictNullChecks: true`
- `noUncheckedIndexedAccess: true` — array/object index access returns `T | undefined`; use `!` non-null assertion only when index is guaranteed
- `useUnknownInCatchVariables: true` — caught errors are `unknown`, not `Error`; must type-narrow before use
- `noImplicitReturns: true`

## Import Organization

**Order (observed pattern):**
1. External packages (`obsidian`, `react`)
2. Internal types (`import type { ... } from '../types'`)
3. Internal modules by layer (utils → sync → ui)

**Path Aliases:**
- `baseUrl: "src"` in `tsconfig.json` — imports within `src/` can be relative or use `src`-rooted paths
- No `@/` or similar aliasing in use

**Import Style:**
- `import type` used for type-only imports throughout: `import type { LumenSettings } from '../types'`
- Named imports preferred; no star imports in source code

## Error Handling

**Philosophy:** Status-code-first classification via `classifyError()` in `src/utils/error-classifier.ts`. All thrown errors from HTTP clients flow through this classifier, producing a `ClassifiedError` with `category`, `message`, `retryable`, and optional `statusCode`.

**Patterns:**
- HTTP errors thrown as `Error` objects with `.status` property attached by callers for status-code-first classification
- `catch (err: unknown)` — caught errors are `unknown` due to `useUnknownInCatchVariables`; use `err instanceof Error` before accessing `.message`
- Custom error classes used for domain-specific control flow: `WorkspaceConfirmationError`, `WorkspaceNameMismatchError`, `PlanUpgradeRequiredError`, `RateLimitExceededError` — all defined in `src/types.ts`
- Individual file failures swallowed with logging to avoid blocking batch operations (see `src/sync/file-hasher.ts` `hashAllFiles`)
- Listener errors swallowed silently with comment: "Never let a listener error break logging" (see `src/utils/logger.ts`)

**Pattern for catch blocks:**
```typescript
} catch (error) {
    logger.error(`Failed to hash ${file.path}:`, error);
}
```

**React errors:**
- `ErrorBoundary` class component (`src/ui/components/shared/ErrorBoundary.tsx`) wraps views to prevent blank screen on uncaught render errors

## Logging

**Framework:** Custom `Logger` class in `src/utils/logger.ts`. Singleton exported as `logger`.

**Setup:**
```typescript
import { logger } from '../utils/logger';
// After loading settings:
logger.setDebugMode(settings.debugMode);
```

**Levels:**
- `logger.debug(...)` — gated behind `debugMode`; only logged to console when enabled
- `logger.info(...)` — always buffered; console output only when `debugMode` is on
- `logger.warn(...)` — always console + buffer
- `logger.error(...)` — always console + buffer

**API key redaction:** All log messages are automatically redacted before output. Never log raw API keys — the logger sanitizes `vr_*` tokens, `X-API-Key` headers, and `Bearer` tokens.

**Ring buffer:** Logger stores up to 500 entries in memory for the Debug Log Viewer.

## Comments

**File-level JSDoc:** Every source file begins with a block comment summarizing purpose, key behaviors, and design decisions. Example:
```typescript
/**
 * FileHasher — SHA-256 hashing with caching and chunked processing.
 *
 * Computes SHA-256 hashes for .md files in the vault...
 */
```

**Section separators:** Long files use dashed separator comments to group related code:
```typescript
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
```

**Inline comments:** Used for non-obvious decisions. Examples:
```typescript
// default — SyncManager determines actual action
// Never let a listener error break logging
// Yield to UI thread between chunks (skip after the last chunk)
```

**Constant comments:** Named constants have JSDoc explaining why the value was chosen:
```typescript
/** Notice duration for errors (WCAG 2.2.1 minimum). */
export const NOTICE_DURATION_ERROR_MS = 8_000;
```

## Function Design

**Size:** Functions are kept small and single-purpose. Private helper functions (`classifyByStatusCode`, `classifyByMessage`, `extractServerDetail`) extracted from public functions.

**Parameters:** Options objects used for functions with many optional parameters:
```typescript
async semanticSearch(query: string, options: { limit?: number; tags?: string[]; ... } = {}): Promise<SearchResult[]>
```

**Static methods:** Used for pure utility logic on classes: `FileHasher.computeSHA256()`, `FileHasher.computeSHA256Binary()`

**Optional chaining:** Used throughout for defensive access: `match?.[1]`, `onProgress?.(current, total)`, `info.componentStack ?? ''`

## Module Design

**Exports:** Named exports everywhere; no default exports except `LumenPlugin` in `src/main.ts` (Obsidian plugin convention requires `export default`).

**Barrel Files:** `src/ui/components/shared/index.ts` re-exports shared UI components. No other barrel files.

**Class structure pattern:**
```typescript
export class MyClass {
    // Dependencies (private)
    // State (private)
    // Timers (private)

    constructor(...)

    // Public API methods

    // Private helpers
}
```

**Constants co-location:** Module-level constants defined at the top of the file, grouped in their own section. Shared constants extracted to `src/sync/constants.ts`.

---

*Convention analysis: 2026-03-11*
