---
team: plan-roadmap-plugin-ux
task: 1
author: ux-architect
status: complete
created: 2026-02-25
---

# Task 1: UI Architecture Analysis & React Migration Strategy

## Current UI Architecture Assessment

### Component Inventory

| File | Lines | Responsibility | Complexity |
|------|-------|---------------|------------|
| `main-view.ts` | 1502 | Tabbed sidebar (Search + Chat) | **High** — God object with 60+ instance vars |
| `settings-tab.ts` | ~400 | Connection, Sync, Advanced settings | Medium |
| `debug-log-view.ts` | ~200 | Scrollable log viewer | Low |
| `similar-notes-modal.ts` | ~150 | Modal for similar notes | Low |
| `help-modal.ts` | ~100 | Documentation modal | Low |
| `sync-status-bar.ts` | 183 | Status bar widget | Low |
| `icons.ts` | 54 | Custom SVG icon registration | Low |
| `styles.css` | 2434 | All styles (BEM-like) | Medium |

### Key Architectural Issues

1. **God Object in main-view.ts**: 1502 lines with ~30 instance variables tracking search state, chat state, tag filter state, conversation state, deep research state, and rate limit state. Every UI operation is an imperative DOM mutation.

2. **No Reactive State Management**: State lives as instance variables (`this.searchInput`, `this.chatMessages`, `this.conversationId`, etc.) with manual DOM updates scattered across 40+ methods. Changes don't propagate — each method must know which DOM elements to touch.

3. **Vanilla DOM Everywhere**: Uses Obsidian's `createEl`/`createDiv` API. Every UI change is an imperative `element.empty()` → `element.createEl()` cycle. No declarative rendering, no diffing.

4. **Tight Coupling**: `main-view.ts` directly accesses `this.plugin.chatClient`, `this.plugin.apiClient`, `this.plugin.settings` — business logic and presentation are interleaved.

5. **No Component Reuse**: Source chips, loading dots, error states, empty states are all inline DOM construction. Same patterns repeated 3-4 times.

### What Works Well

- Clean separation of HTTP clients (ApiClient, ChatClient, SyncClient)
- Good error classification system (shared across search and sync)
- Proper use of Obsidian's `ItemView` lifecycle
- Accessible ARIA attributes on status bar
- RAF-batched token rendering in chat streaming

## React-in-Obsidian Integration Patterns

### How Other Plugins Do It

The established pattern for React in Obsidian plugins:

```typescript
class LumenMainView extends ItemView {
  root: Root | null = null;

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    this.root = createRoot(container);
    this.root.render(
      <AppProvider plugin={this.plugin}>
        <LumenApp />
      </AppProvider>
    );
  }

  async onClose() {
    this.root?.unmount();
    this.root = null;
  }
}
```

**Key constraints:**
- `createRoot` on the `ItemView` container element
- Must unmount on `onClose()` to prevent memory leaks
- `obsidian` module stays external — React is bundled
- esbuild handles JSX transformation natively (add `jsx: 'react-jsx'`)

### Build System Changes

Current esbuild config needs minimal changes:
- Add `react` and `react-dom` as dependencies (not externals)
- Add JSX support: `jsx: 'react-jsx'`, `jsxImportSource: 'react'`
- Bundle size: React 18 = ~42KB gzipped (well within Obsidian plugin norms)
- Keep `target: 'es2018'` for compatibility

### Mobile Compatibility

React works fine on Obsidian mobile (iOS/Android):
- Same WebView engine, same DOM API
- No special mobile considerations for React itself
- CSS must use `var(--*)` Obsidian variables for theme compatibility
- Touch events handled by React's synthetic event system
- Performance: React's virtual DOM is actually lighter than imperative DOM on mobile

## Proposed Component Hierarchy

```
<LumenApp>
  <TabBar activeTab={mode} onSwitch={setMode} />

  {mode === 'search' && (
    <SearchView>
      <SearchInput value={query} onChange={...} />
      <SearchToolbar>
        <HybridToggle />
        <TagFilterToggle />
      </SearchToolbar>
      <TagFilterPanel tags={...} selected={...} />
      <SearchStatus state={...} />
      <SearchResults results={...}>
        <ResultItem /> (per result)
      </SearchResults>
      <EmptyState /> | <ErrorState /> | <LoadingState />
    </SearchView>
  )}

  {mode === 'chat' && (
    <ChatView>
      <ConversationHeader title={...} />
      <ConversationDropdown conversations={...} />
      <ChatMessages messages={...}>
        <MessageBubble /> (per message)
        <SourceChips sources={...} />
      </ChatMessages>
      <ChatEmptyState />
      <RateLimitBanner />
      <ChatInput>
        <DeepResearchToggle />
        <SendButton /> | <StopButton />
      </ChatInput>
    </ChatView>
  )}
</LumenApp>
```

## State Management Recommendation

**Recommendation: React Context + useReducer (no external library)**

Rationale:
- Plugin state is modest (~15 top-level state values)
- No need for Zustand/Jotai/Redux overhead
- Two isolated state domains (search + chat) map perfectly to two contexts
- Obsidian plugin consumers are used to zero-dependency plugins

Proposed contexts:
1. `PluginContext` — plugin instance, apiClient, chatClient, settings (read-only)
2. `SearchContext` — query, results, hybridMode, selectedTags, loading state
3. `ChatContext` — messages, conversationId, sending state, deep research toggle

Custom hooks:
- `useSearch(query)` — debounced search with error handling
- `useChat()` — message sending, streaming, conversation management
- `useSyncStatus()` — subscribes to SyncManager state changes

## Styling Strategy

**Recommendation: Obsidian CSS variables + CSS Modules**

- Keep all `var(--background-primary)`, `var(--text-normal)`, etc. for theme compat
- Use CSS Modules via esbuild plugin for scoped class names
- Migrate existing BEM classes progressively (`.lumen-*` → modules)
- No Tailwind — it adds 10KB+ of runtime and conflicts with Obsidian's theme system

## Animation Strategy

For sync/upload indicators:
- **CSS animations** for simple states (spinner rotation, pulse, fade)
- **Framer Motion** (optional, 15KB) for complex sequences
- **Recommendation: CSS-only animations** — keep bundle minimal, sufficient for all current needs (loading dots, spinner, success checkmark, error shake)

Specific animations needed:
- Sync spinner (already exists via `loader-2` icon, but needs CSS `@keyframes spin`)
- Upload progress bar (CSS `width` transition)
- Success checkmark (SVG path animation)
- Error shake (CSS `@keyframes shake`)
- Chat typing indicator (existing dot animation, keep)
- Message fade-in (CSS `@keyframes fadeIn`)

## Migration Strategy: Incremental, Not Big-Bang

### Phase 1: Scaffold (1-2 days)
- Add React + React-DOM dependencies
- Update esbuild config for JSX
- Create `LumenApp.tsx` shell with tab bar
- Wrap existing `onOpen()` logic: React renders the shell, individual views still vanilla

### Phase 2: Search View (2-3 days)
- Extract search into `<SearchView>` with React state
- Create `useSearch` hook wrapping `ApiClient.semanticSearch`
- Migrate tag filter, result rendering, error states

### Phase 3: Chat View (3-4 days)
- Extract chat into `<ChatView>` with React state
- Create `useChat` hook wrapping `ChatClient.sendMessage`
- Handle streaming tokens via state updates + RAF batching
- Migrate conversation management, source chips, empty/error states

### Phase 4: Shared Components (1 day)
- `<SourceChip>`, `<EmptyState>`, `<ErrorState>`, `<LoadingDots>`
- `<MarkdownContent>` wrapper around `MarkdownRenderer.render()`

### Phase 5: Settings + Modals (optional, lower priority)
- Settings tab could stay vanilla (it uses Obsidian's `PluginSettingTab` API)
- Modals could stay vanilla (low complexity)

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| React bundle size bloat | Low | Low | Tree-shaking, React is ~42KB gzipped |
| Mobile performance regression | Low | Medium | Profile on iOS/Android during development |
| Obsidian API incompatibility | Low | High | `MarkdownRenderer.render()` works in React via `useRef` |
| Loss of Obsidian CSS theme compat | Medium | High | Keep all `var(--*)` references, no custom color values |
| Incremental migration stalls midway | Medium | Medium | Each phase delivers standalone value |
