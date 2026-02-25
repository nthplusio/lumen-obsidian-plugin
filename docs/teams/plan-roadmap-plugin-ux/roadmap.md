---
team: plan-roadmap-plugin-ux
task: 9
author: strategist
status: complete
created: 2026-02-25
---

# Lumen Obsidian Plugin Roadmap

## Executive Summary

This roadmap transforms the Lumen Obsidian plugin from functional-but-unpolished to marketplace-ready and exceptional. It covers five phases spanning approximately 30-35 working days, ordered by dependencies and impact:

1. **Phase 0** — Fix broken chat and critical resilience gaps (3-5 days)
2. **Phase 1** — Harden error handling, retry logic, and logging (2-3 days)
3. **Phase 2** — Migrate main sidebar UI to React (8-10 days)
4. **Phase 3** — Ship high-impact UX features (5-6 days)
5. **Phase 4** — Build differentiating features (10-12 days)

Each phase delivers standalone value. The plugin can be shipped to the marketplace after Phase 3 with confidence; Phase 4 adds competitive differentiation post-launch.

---

## Phase 0: Fix Chat + Critical Resilience

**Duration:** 3-5 days
**Goal:** Make the plugin work reliably for all core features.
**Prerequisite for:** All subsequent phases.

### Deliverables

| Item | Effort | Description |
|------|--------|-------------|
| **Fix chat** | 1-2 days | Investigate `requestUrl` timeout on SSE streaming. Likely fix: switch chat HTTP from `requestUrl` to native `fetch` + `ReadableStream` for true real-time streaming. Add diagnostic logging. Fallback: timeout wrapper if CORS blocks `fetch`. |
| **Offline detection** | 0.5 days | `navigator.onLine` + `online`/`offline` event listeners. Pause auto-sync when offline. Show "Offline" in status bar. Auto-sync when back online. |
| **Sync cancellation** | 0.5 days | `AbortController` on upload/download requests. "Cancel" action in status bar during uploads. |
| **Chat cancel fix** | 0.5 days | Wire `AbortController` to the chat request so cancel actually aborts the HTTP call, not just sets a flag. |

### Success Criteria

- Chat works for both short and long messages (tested up to 60s generation)
- Plugin shows "Offline" when device loses connection
- User can cancel a sync mid-upload
- Chat cancel stops token generation immediately

### Key Files Modified

- `src/chat-client.ts` — New `sendMessageStream()` with `fetch` + `ReadableStream`
- `src/sync/sync-manager.ts` — `AbortController` + `cancelSync()`
- `src/sync/sync-status-bar.ts` — Offline indicator + cancel button
- New: `src/utils/network-status.ts` — Singleton network status observer

---

## Phase 1: Resilience Polish

**Duration:** 2-3 days
**Goal:** Improve error handling quality and debugging capability.
**Can overlap with:** Early Phase 2 (build system setup).

### Deliverables

| Item | Effort | Description |
|------|--------|-------------|
| **Improve error classifier** | 0.5 days | Use HTTP status codes as primary classifier (not string matching). Keep message patterns as fallback. |
| **Add retry jitter** | 0.25 days | `delay * (0.5 + Math.random())` on all exponential backoff. Prevents thundering herd. |
| **Auto-restart on 410** | 0.5 days | Detect expired sync session, automatically start fresh sync instead of showing error. |
| **Log export** | 0.5 days | "Copy to Clipboard" and "Save to File" buttons in debug log view. |
| **Classify chat errors** | 0.25 days | Use existing `classifyError()` in chat catch block for context-aware error messages. |
| **Make ENOTFOUND retryable** | 0.25 days | DNS errors can be transient; allow retry with longer backoff. |

### Success Criteria

- Error messages are actionable (user knows what to do)
- Retry delays show visible jitter in logs
- Expired sync sessions auto-recover
- Users can export debug logs for bug reports

### Key Files Modified

- `src/utils/error-classifier.ts` — Status-code-first classification
- `src/sync/sync-manager.ts` — Jitter + 410 auto-restart
- `src/debug-log-view.ts` — Export buttons
- `src/main-view.ts` — Classified chat errors

---

## Phase 2: React Migration

**Duration:** 8-10 days
**Goal:** Replace the 1502-line vanilla DOM sidebar with React components.
**Scope:** Main sidebar view only. Settings tab, modals, and debug log stay vanilla.
**Prerequisite for:** Phases 3 and 4 (feature work benefits from React).

### Sub-phases

| Step | Duration | Deliverable |
|------|----------|------------|
| **2.1 Build system + deps** | 0.5 days | Add `react`, `react-dom`. Enable JSX in esbuild. ~42KB bundle addition. |
| **2.2 React shell** | 1 day | `LumenApp.tsx` with tab bar. `PluginContext` for plugin/app/view access. `main-view.tsx` thin wrapper using `createRoot`. |
| **2.3 Search view** | 2-3 days | `SearchView`, `SearchInput`, `ResultItem`, `TagFilterPanel`. `useSearch` hook with debounce, retry, error handling. CSS modules for scoped styles. |
| **2.4 Chat view** | 3-4 days | `ChatView`, `ChatInput`, `MessageBubble`, `ConversationHeader`. `useChat` hook with streaming, conversation management, abort support. `MarkdownContent` bridge component. |
| **2.5 Shared components** | 1 day | `EmptyState`, `ErrorState`, `LoadingDots`, `SourceChips`, `MarkdownContent`. |

### Architecture Decisions

- **State management:** React Context + `useReducer`. Three contexts: `PluginContext` (read-only), `SearchContext`, `ChatContext`. No external state library.
- **Styling:** Obsidian CSS variables (`var(--*)`) for theme compatibility + CSS Modules for scoping. No Tailwind.
- **Animations:** CSS-only (`@keyframes spin`, `fadeIn`, `shake`). No Framer Motion.
- **Obsidian integration:** `MarkdownRenderer.render()` via `useRef` + `useEffect`. Event listeners via `useEffect` cleanup.
- **Mobile:** React works identically on Obsidian mobile. Touch targets minimum 44x44px.

### File Structure

```
src/
  main-view.tsx          # Thin ItemView wrapper (replaces main-view.ts)
  ui/
    LumenApp.tsx
    contexts/            # PluginContext, SearchContext, ChatContext
    components/
      TabBar.tsx
      search/            # SearchView, SearchInput, ResultItem, etc.
      chat/              # ChatView, ChatInput, MessageBubble, etc.
      shared/            # EmptyState, ErrorState, LoadingDots, etc.
    hooks/               # useSearch, useChat, useSyncStatus, useDebounce
    styles/              # CSS Modules
```

### Success Criteria

- All existing functionality preserved (search, chat, tags, hybrid mode, deep research)
- All 602 existing tests still pass
- Theme compatibility with light/dark Obsidian themes
- Mobile parity (iOS + Android)
- `main-view.ts` (1502 lines) deleted, replaced by ~15 focused component files

### Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `MarkdownRenderer.render()` in React | Proven pattern via `useRef`; used by Copilot plugin |
| Bundle size | React 18 = ~42KB gzipped; total ~102KB (normal for Obsidian plugins) |
| CORS with `fetch` in Electron | Test early in Phase 0 chat fix; fallback to `requestUrl` wrapper |
| Theme breakage | All CSS uses Obsidian variables; zero hardcoded colors |

---

## Phase 3: UX Features

**Duration:** 5-6 days
**Goal:** Make the plugin feel polished and marketplace-ready.
**Depends on:** Phase 2 (React components).

### Deliverables

| Feature | Effort | Impact | Description |
|---------|--------|--------|-------------|
| **Onboarding flow** | 1-2 days | High | Welcome screen → API key entry → auto-connect → auto-sync → ready. Replaces "Not configured" error. |
| **Quick-open search modal** | 1.5 days | Very High | `Ctrl+Shift+L` opens floating modal with instant results, arrow-key navigation, Enter to open. Omnisearch-style. |
| **Active note context** | 1 day | High | Toggle to include current note as context when chatting. Shows active file name above chat input. |
| **Keyboard shortcuts** | 0.5 days | Medium-High | `Focus search`, `New chat`, `Toggle Search/Chat`, `Quick search` commands. |
| **Improved empty states** | 0.5 days | Medium | Purposeful empty states for every view state (offline, no API key, no results, etc.). |

### Success Criteria

- New user can go from install to first search in under 60 seconds
- Power users can search without touching the mouse
- Chat feels contextual when a note is open
- Every blank screen tells the user what to do next

---

## Phase 4: Differentiating Features

**Duration:** 10-12 days
**Goal:** Build features that set Lumen apart from competitors.
**Depends on:** Phase 3 (some features build on onboarding and React components).

### Deliverables

| Feature | Effort | Impact | Description |
|---------|--------|--------|-------------|
| **Related notes panel** | 3 days | High | Third tab showing semantically similar notes to active file. Auto-updates on file switch. Leverages existing `searchSimilarDocuments` API. Debounced + cached. |
| **Search results preview** | 2.5 days | Medium-High | Hover (desktop) or long-press (mobile) shows content preview with "Open to the Right" action. Reduces context-switching. |
| **Search history & saved searches** | 2 days | Medium | Recent queries dropdown, bookmark queries, saved searches in command palette. |
| **Conflict resolution UI** | 3-4 days | Medium | Modal showing side-by-side diff for sync conflicts. "Keep Mine" / "Keep Server" / "Keep Both" per file. Replaces server-always-wins behavior. |

### Success Criteria

- Related notes surface useful connections automatically
- Users can preview results without leaving their current context
- Repeat searches take one click
- Conflict resolution is transparent, not surprising

---

## Dependency Graph

```
Phase 0 ─────────────────────────────────────────────────────────────────────
  Fix Chat ─────────┐
  Offline Detection  ├──→ Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4
  Sync Cancel       │       │           │
  Chat Cancel Fix ──┘       │           │
                            │           │
  Phase 1 can overlap ──────┘           │
  with Phase 2 build setup              │
                                        │
  True streaming for chat ──────────────┘
  (implemented during React ChatView migration)
```

**Critical path:** Phase 0 → Phase 2 → Phase 3 (React migration blocks feature work)

**Parallelizable:** Phase 1 resilience items can overlap with Phase 2 steps 2.1-2.2 (build system and scaffold).

---

## Timeline Summary

| Phase | Days | Cumulative | Key Milestone |
|-------|------|-----------|---------------|
| **Phase 0**: Fix + Critical | 3-5 | 3-5 | Chat works, offline detection |
| **Phase 1**: Resilience | 2-3 | 5-8 | Error handling hardened |
| **Phase 2**: React Migration | 8-10 | 13-18 | Sidebar fully in React |
| **Phase 3**: UX Features | 5-6 | 18-24 | **Marketplace-ready** |
| **Phase 4**: Differentiators | 10-12 | 28-36 | Competitive advantage |

**Marketplace-ready after Phase 3** (~18-24 working days). Phase 4 adds post-launch competitive differentiation.

---

## Risk Assessment

| Risk | Phase | Likelihood | Impact | Mitigation |
|------|-------|-----------|--------|------------|
| `fetch` CORS in Electron blocks chat streaming | 0 | Medium | High | Fallback: `requestUrl` with timeout wrapper; test early |
| React migration takes longer than estimated | 2 | Medium | Medium | Each sub-phase ships independently; can release at any step |
| Obsidian theme compatibility breaks | 2 | Low | High | All CSS uses `var(--*)` variables; test with 3+ themes |
| Mobile performance regression | 2 | Low | Medium | Profile on real devices; React vDOM is typically lighter |
| Chat streaming pattern differs from expectation | 0 | Low | High | Add diagnostic logging first; test with real server |
| Conflict resolution needs server changes | 4 | High | Medium | Stub with client-side resolution; defer server integration |
| Onboarding API key validation edge cases | 3 | Medium | Low | Handle invalid key, network error, wrong workspace gracefully |

---

## What's Not In Scope

The following were considered but deferred beyond this roadmap:

- **Note generation / AI writing** — Requires new server endpoints; high effort (5-7 days)
- **Graph-aware search** — Requires server-side graph traversal; high effort (5 days)
- **Multi-vault support** — Requires workspace switcher in plugin; server already supports it
- **Settings tab React migration** — Works fine as vanilla Obsidian DOM
- **Debug log view React migration** — Low complexity, not worth migrating
- **Battery-aware sync on mobile** — Limited API access; not reliable cross-platform

---

## Supporting Documents

Detailed analysis and implementation plans are in:

- `docs/teams/plan-roadmap-plugin-ux/tasks/task-1-ux-architect.md` — UI architecture analysis
- `docs/teams/plan-roadmap-plugin-ux/tasks/task-2-resilience-engineer.md` — Resilience audit (18 findings)
- `docs/teams/plan-roadmap-plugin-ux/tasks/task-3-feature-analyst.md` — Competitive analysis & feature recommendations
- `docs/teams/plan-roadmap-plugin-ux/tasks/task-5-ux-architect.md` — Detailed React migration plan (component designs, hooks, CSS modules)
- `docs/teams/plan-roadmap-plugin-ux/tasks/task-6-resilience-engineer.md` — Detailed resilience plan (implementation code, testing strategy)
- `docs/teams/plan-roadmap-plugin-ux/tasks/task-7-feature-analyst.md` — Detailed feature plans (effort estimates, React component designs)
