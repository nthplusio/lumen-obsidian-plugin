# Codebase Structure

**Analysis Date:** 2026-03-11

## Directory Layout

```
lumen-obsidian-plugin/
├── src/                        # All plugin source
│   ├── main.ts                 # Plugin entry point (LumenPlugin class)
│   ├── main-view.tsx           # React ItemView wrapper for sidebar
│   ├── api-client.ts           # Search/content HTTP client
│   ├── chat-client.ts          # Conversations/SSE streaming HTTP client
│   ├── http-client.ts          # Abstract base HTTP client
│   ├── types.ts                # All shared TypeScript types and interfaces
│   ├── icons.ts                # Custom SVG icon registration
│   ├── settings-tab.ts         # Obsidian settings tab (vanilla DOM)
│   ├── dataview-api.ts         # Public Dataview JS API (experimental)
│   ├── debug-log-view.ts       # Debug log sidebar view (vanilla DOM)
│   ├── help-modal.ts           # Help modal (vanilla DOM)
│   ├── help-content.ts         # Static help content strings
│   ├── similar-notes-modal.ts  # "Find similar" modal (vanilla DOM)
│   ├── quick-search-modal.tsx  # Quick search popup (React)
│   ├── sync/                   # Sync subsystem
│   │   ├── sync-manager.ts     # Sync orchestrator and state machine
│   │   ├── sync-client.ts      # Sync HTTP endpoints
│   │   ├── file-hasher.ts      # SHA-256 vault hashing with cache
│   │   ├── sync-status-bar.ts  # Status bar widget (vanilla DOM)
│   │   ├── conflict-logger.ts  # Writes .lumen-conflicts.md
│   │   ├── conflict-resolution-modal.ts  # Conflict resolution dialog
│   │   ├── workspace-confirmation-modal.ts  # Workspace confirmation dialog
│   │   └── constants.ts        # Sync constants (batch size, extensions)
│   ├── ui/                     # React UI layer
│   │   ├── LumenApp.tsx        # Root React component
│   │   ├── contexts/
│   │   │   └── PluginContext.tsx  # Plugin dependency injection context
│   │   ├── hooks/              # Feature-specific React hooks
│   │   │   ├── useSearch.ts    # Search state + debounce + retry
│   │   │   ├── useChat.ts      # Chat state + SSE streaming
│   │   │   ├── useSyncState.ts # Bridge: plugin sync state → React
│   │   │   ├── usePlanState.ts # Bridge: plugin plan state → React
│   │   │   ├── useConflicts.ts # Bridge: plugin conflicts → React
│   │   │   └── useRelatedNotes.ts  # Related notes query hook
│   │   ├── components/
│   │   │   ├── search/
│   │   │   │   └── SearchView.tsx    # Full search interface
│   │   │   ├── chat/
│   │   │   │   └── ChatView.tsx      # Full chat interface
│   │   │   ├── related/
│   │   │   │   └── RelatedNotesView.tsx  # Related notes panel
│   │   │   ├── onboarding/
│   │   │   │   └── OnboardingView.tsx    # First-run setup screen
│   │   │   ├── shared/         # Reusable primitive components
│   │   │   │   ├── index.ts    # Barrel export
│   │   │   │   ├── ErrorBoundary.tsx
│   │   │   │   ├── ErrorState.tsx
│   │   │   │   ├── EmptyState.tsx
│   │   │   │   ├── LoadingDots.tsx
│   │   │   │   ├── MarkdownContent.tsx
│   │   │   │   ├── SourceChips.tsx
│   │   │   │   └── TagChip.tsx
│   │   │   ├── TabBar.tsx          # Search/Chat/Related tab switcher
│   │   │   ├── SidebarHeader.tsx   # Top header with sync strip slot
│   │   │   ├── SyncStatusStrip.tsx # Inline sync progress (React)
│   │   │   ├── ConflictBanner.tsx  # Conflict alert banner
│   │   │   └── UpgradeRequiredView.tsx  # Plan upgrade gate
│   │   └── styles/             # CSS modules or global styles
│   └── utils/                  # Pure shared utilities
│       ├── error-classifier.ts # HTTP error classification
│       ├── exclude-pattern.ts  # Glob pattern matching for file exclusion
│       ├── logger.ts           # Ring-buffer logger with redaction
│       ├── network-status.ts   # online/offline singleton
│       ├── path-safety.ts      # Path traversal validation
│       └── sse-parser.ts       # Server-Sent Events stream parser
├── tests/                      # Vitest test suite
│   ├── __mocks__/
│   │   └── obsidian.ts         # Minimal Obsidian API stubs
│   ├── sync/                   # Sync subsystem tests
│   ├── utils/                  # Utility unit tests
│   ├── ui/                     # React component/hook tests
│   └── integration/            # Integration flow tests
├── docs/                       # Planning and design documents
│   └── teams/                  # Feature team task docs
├── .planning/                  # GSD planning artifacts
│   └── codebase/               # Codebase analysis documents
├── .github/
│   └── workflows/              # GitHub Actions (release.yml)
├── .githooks/                  # Git hook scripts
├── scripts/                    # Build/release scripts
├── esbuild.config.mjs          # esbuild bundler config
├── vitest.config.ts            # Vitest test config
├── tsconfig.json               # TypeScript config
├── manifest.json               # Obsidian plugin manifest (release)
├── manifest-beta.json          # Obsidian plugin manifest (beta)
├── package.json                # npm workspace member
├── styles.css                  # Plugin CSS (committed, loaded by Obsidian)
└── main.js                     # Built output (gitignored — built by CI)
```

## Directory Purposes

**`src/`:**
- Purpose: All TypeScript/TSX source for the plugin
- Contains: Plugin core, HTTP clients, sync subsystem, React UI, utilities, types
- Key files: `src/main.ts` (entry), `src/types.ts` (all types)

**`src/sync/`:**
- Purpose: Self-contained vault synchronization subsystem
- Contains: State machine orchestrator, HTTP client, file hasher, conflict handling, status bar
- Key files: `src/sync/sync-manager.ts`, `src/sync/file-hasher.ts`, `src/sync/sync-client.ts`

**`src/ui/`:**
- Purpose: All React UI — root component, context, hooks, view components
- Contains: Feature views (Search, Chat, Related, Onboarding), bridging hooks, shared primitives
- Key files: `src/ui/LumenApp.tsx`, `src/ui/contexts/PluginContext.tsx`

**`src/utils/`:**
- Purpose: Pure, dependency-free utility functions shared across all layers
- Contains: Logger, error classifier, path safety, network status, SSE parser, exclude pattern
- Key files: `src/utils/logger.ts`, `src/utils/error-classifier.ts`

**`tests/`:**
- Purpose: Vitest test suite co-located by subsystem
- Contains: Tests mirroring the `src/` structure with `__mocks__/obsidian.ts` for Obsidian API stubs
- Key files: `tests/__mocks__/obsidian.ts`, `tests/sync/sync-manager.test.ts`

## Key File Locations

**Entry Points:**
- `src/main.ts`: Plugin class, `onload`/`onunload`, all initialization
- `src/main-view.tsx`: React root mount (`LumenMainView`)

**Configuration:**
- `src/types.ts`: `LumenSettings` interface and `DEFAULT_SETTINGS`
- `tsconfig.json`: TypeScript compiler options (`noUncheckedIndexedAccess: true`, `strict: true`)
- `esbuild.config.mjs`: Bundle config (CJS output, ES2018 target, externals list)
- `vitest.config.ts`: Test runner config, `obsidian` module alias to `tests/__mocks__/obsidian.ts`

**Core Logic:**
- `src/sync/sync-manager.ts`: Sync state machine (largest file, ~1050 lines)
- `src/chat-client.ts`: SSE streaming logic, Node `https` / `requestUrl` dual path
- `src/utils/sse-parser.ts`: SSE event parsing

**Testing:**
- `tests/__mocks__/obsidian.ts`: Obsidian API stubs (required for all tests)
- `tests/sync/`: Sync subsystem unit and integration tests
- `tests/integration/sync-flow.test.ts`: End-to-end sync protocol tests

## Naming Conventions

**Files:**
- `kebab-case.ts` for all source files (e.g., `sync-manager.ts`, `error-classifier.ts`)
- `.tsx` extension for files with JSX (e.g., `main-view.tsx`, `LumenApp.tsx`, `SearchView.tsx`)
- React components use `PascalCase.tsx` (e.g., `SearchView.tsx`, `ChatView.tsx`)
- Hooks use `camelCase.ts` with `use` prefix (e.g., `useSearch.ts`, `useSyncState.ts`)
- Test files mirror source path with `.test.ts` or `.test.tsx` suffix

**Directories:**
- `kebab-case` for subsystem directories (`sync/`, `utils/`)
- `camelCase` for React-specific directories (`components/`, `contexts/`, `hooks/`)
- Feature subdirectories within `components/` are `camelCase` (e.g., `search/`, `chat/`, `related/`)

## Where to Add New Code

**New API endpoint:**
- Add method to `src/api-client.ts` (search/content) or `src/chat-client.ts` (conversations)
- Add response type to `src/types.ts`
- If it's a sync endpoint, add to `src/sync/sync-client.ts`

**New React view or panel:**
- Create `src/ui/components/<feature>/FeatureName.tsx`
- Create logic hook at `src/ui/hooks/useFeature.ts`
- Import and render in `src/ui/LumenApp.tsx`
- Add tests to `tests/ui/`

**New React shared component:**
- Add to `src/ui/components/shared/`
- Export from `src/ui/components/shared/index.ts` barrel

**New setting:**
- Add field to `LumenSettings` interface in `src/types.ts`
- Add default to `DEFAULT_SETTINGS` in `src/types.ts`
- Add UI control in `src/settings-tab.ts`

**New utility function:**
- Add to the relevant file in `src/utils/` (or create a new file if the concern is distinct)
- Pure functions only — no Obsidian API dependencies in `src/utils/`

**New sync feature:**
- Add to `src/sync/sync-manager.ts` (orchestration) or a new file in `src/sync/`
- Update `SyncState` union in `src/types.ts` if a new state is needed
- Add tests to `tests/sync/`

**New Obsidian modal:**
- Create `src/<feature>-modal.ts` (vanilla DOM, extends `Modal`)
- Or `src/<feature>-modal.tsx` if it uses React

## Special Directories

**`.planning/`:**
- Purpose: GSD planning documents and codebase analysis
- Generated: No (manually authored)
- Committed: Yes

**`coverage/`:**
- Purpose: Vitest v8 coverage output
- Generated: Yes (`npm run test:coverage`)
- Committed: No (gitignored)

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes
- Committed: No

---

*Structure analysis: 2026-03-11*
