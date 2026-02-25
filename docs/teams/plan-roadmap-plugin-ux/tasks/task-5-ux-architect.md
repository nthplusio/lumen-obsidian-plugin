---
team: plan-roadmap-plugin-ux
task: 5
author: ux-architect
status: complete
created: 2026-02-25
---

# Task 5: Detailed React Migration Plan

## Scope

Migrate the main sidebar view (`main-view.ts`, 1502 lines) to React. Settings tab, modals, and debug log view stay vanilla Obsidian DOM (per user approval).

## Prerequisites

React migration is Phase 2 in the roadmap. It depends on:
- Phase 0 (chat fix) completing first — no point migrating broken features
- Phase 1 (resilience) completing first — error handling patterns should be stable before React wraps them

## Step 1: Build System & Dependencies (0.5 days)

### Package Changes

```bash
npm install react react-dom
npm install -D @types/react @types/react-dom
```

### esbuild Config Update

```javascript
// esbuild.config.mjs additions
const context = await esbuild.context({
  // ... existing config ...
  jsx: 'automatic',        // React 17+ JSX transform (no import React needed)
  jsxImportSource: 'react',
  loader: {
    '.tsx': 'tsx',
    '.ts': 'ts',
    '.css': 'css',
  },
  // react and react-dom are NOT externals — they get bundled
});
```

### tsconfig Changes

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  }
}
```

### File Structure

```
src/
  main.ts                      # Plugin entry (unchanged)
  main-view.ts → main-view.tsx # Thin ItemView wrapper
  ui/
    LumenApp.tsx               # Root React component
    contexts/
      PluginContext.tsx         # Plugin instance, clients, settings
      SearchContext.tsx         # Search state + reducer
      ChatContext.tsx           # Chat state + reducer
    components/
      TabBar.tsx
      search/
        SearchView.tsx
        SearchInput.tsx
        SearchToolbar.tsx
        TagFilterPanel.tsx
        ResultItem.tsx
        SearchStatus.tsx
      chat/
        ChatView.tsx
        ChatInput.tsx
        MessageBubble.tsx
        ConversationHeader.tsx
        ConversationDropdown.tsx
        SourceChips.tsx
        DeepResearchToggle.tsx
      shared/
        EmptyState.tsx
        ErrorState.tsx
        LoadingDots.tsx
        MarkdownContent.tsx
    hooks/
      useSearch.ts
      useChat.ts
      useSyncStatus.ts
      useDebounce.ts
    styles/
      search.module.css
      chat.module.css
      shared.module.css
```

## Step 2: React Shell / Scaffold (1 day)

### main-view.tsx — Thin ItemView Wrapper

```tsx
import { ItemView, WorkspaceLeaf } from 'obsidian';
import { createRoot, Root } from 'react-dom/client';
import type LumenPlugin from './main';
import { LumenApp } from './ui/LumenApp';
import { PluginProvider } from './ui/contexts/PluginContext';

export const VIEW_TYPE_LUMEN_MAIN = 'lumen-main-view';

export class LumenMainView extends ItemView {
  private plugin: LumenPlugin;
  private root: Root | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LumenPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE_LUMEN_MAIN; }
  getDisplayText(): string { return 'Lumen'; }
  getIcon(): string { return 'lumen-search'; }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('lumen-main-container');

    this.root = createRoot(container);
    this.root.render(
      <PluginProvider plugin={this.plugin} app={this.app} view={this}>
        <LumenApp />
      </PluginProvider>
    );
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }
}
```

### PluginContext.tsx

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import type { App, ItemView } from 'obsidian';
import type LumenPlugin from '../../main';

interface PluginContextValue {
  plugin: LumenPlugin;
  app: App;
  view: ItemView;
}

const PluginContext = createContext<PluginContextValue | null>(null);

export function PluginProvider({
  plugin, app, view, children,
}: PluginContextValue & { children: ReactNode }) {
  return (
    <PluginContext.Provider value={{ plugin, app, view }}>
      {children}
    </PluginContext.Provider>
  );
}

export function usePlugin(): PluginContextValue {
  const ctx = useContext(PluginContext);
  if (!ctx) throw new Error('usePlugin must be used within PluginProvider');
  return ctx;
}
```

### LumenApp.tsx (initial shell)

```tsx
import { useState } from 'react';
import { TabBar } from './components/TabBar';
import { SearchView } from './components/search/SearchView';
import { ChatView } from './components/chat/ChatView';

type ViewMode = 'search' | 'chat';

export function LumenApp() {
  const [mode, setMode] = useState<ViewMode>('search');

  return (
    <>
      <TabBar activeTab={mode} onSwitch={setMode} />
      {mode === 'search' ? <SearchView /> : <ChatView />}
    </>
  );
}
```

## Step 3: Search View Migration (2-3 days)

### SearchContext State Shape

```typescript
interface SearchState {
  query: string;
  results: SearchResult[];
  status: 'idle' | 'loading' | 'retrying' | 'error' | 'success';
  error: ClassifiedError | null;
  retryCount: number;
  hybridMode: boolean;
  selectedTags: string[];
  tagCache: Array<{ tag: string; count: number }> | null;
  tagFilterOpen: boolean;
}
```

### useSearch Hook

```typescript
function useSearch() {
  const { plugin } = usePlugin();
  const [state, dispatch] = useReducer(searchReducer, initialSearchState);

  const search = useDebouncedCallback(async (query: string) => {
    dispatch({ type: 'SEARCH_START' });
    try {
      const results = await plugin.apiClient.semanticSearch(query, {
        limit: 20,
        hybrid: state.hybridMode || undefined,
        tags: state.selectedTags.length > 0 ? state.selectedTags : undefined,
      });
      dispatch({ type: 'SEARCH_SUCCESS', results });
    } catch (err) {
      const classified = classifyError(err);
      if (classified.retryable && state.retryCount < MAX_RETRIES) {
        dispatch({ type: 'SEARCH_RETRY' });
        // Retry handled by effect
      } else {
        dispatch({ type: 'SEARCH_ERROR', error: classified });
      }
    }
  }, 300);

  return { ...state, search, dispatch };
}
```

### MarkdownContent Component

Critical bridge component — uses Obsidian's `MarkdownRenderer.render()` inside a React `useRef`:

```tsx
function MarkdownContent({ content, sourcePath = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { app, view } = usePlugin();

  useEffect(() => {
    if (!ref.current) return;
    ref.current.empty();
    MarkdownRenderer.render(app, content, ref.current, sourcePath, view);
  }, [content, sourcePath, app, view]);

  return <div ref={ref} className="lumen-markdown-content" />;
}
```

### Migration Approach

1. Create `SearchView.tsx` with all sub-components
2. Wire to `SearchContext` + `useSearch` hook
3. Delete corresponding methods from old `main-view.ts`
4. Verify search works end-to-end
5. Run existing tests (they mock Obsidian, should still pass)

## Step 4: Chat View Migration (3-4 days)

### ChatContext State Shape

```typescript
interface ChatState {
  messages: ChatMessage[];
  conversationId: string | null;
  conversationTitle: string | null;
  isSending: boolean;
  isCancelled: boolean;
  streamedContent: string;
  deepResearchEnabled: boolean;
  canDeepResearch: boolean;
  rateLimitInfo: { message: string; resetsAt: string } | null;
}
```

### useChat Hook

```typescript
function useChat() {
  const { plugin } = usePlugin();
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (message: string) => {
    const chatClient = plugin.chatClient;
    if (!chatClient || state.isSending) return;

    dispatch({ type: 'SEND_START', message });

    try {
      // Lazy conversation creation
      let convId = state.conversationId;
      if (!convId) {
        const conv = await chatClient.createConversation();
        convId = conv.id;
        dispatch({ type: 'SET_CONVERSATION', id: convId });
      }

      const response = await chatClient.sendMessage(convId, message, {
        deepResearch: state.deepResearchEnabled,
        onToken: (token) => {
          if (!state.isCancelled) {
            dispatch({ type: 'STREAM_TOKEN', token });
          }
        },
      });

      dispatch({ type: 'SEND_SUCCESS', response });
    } catch (err) {
      // Error handling with classifyError
      dispatch({ type: 'SEND_ERROR', error: err });
    }
  }, [plugin, state.conversationId, state.isSending, state.deepResearchEnabled]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: 'CANCEL' });
  }, []);

  return { ...state, sendMessage, cancel, dispatch };
}
```

### Streaming Token Rendering

The current RAF-batching for streaming tokens translates naturally to React:

```tsx
function StreamingContent({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    // Batch DOM updates to animation frames
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.textContent = content;
      }
    });
    return () => cancelAnimationFrame(rafRef.current);
  }, [content]);

  return <div ref={ref} className="lumen-chat-streaming" />;
}
```

After streaming completes, switch to `<MarkdownContent>` for proper rendering.

## Step 5: Shared Components (1 day)

### Component Catalog

| Component | Props | Used By |
|-----------|-------|---------|
| `EmptyState` | `icon, title, description, children?` | Search, Chat |
| `ErrorState` | `error: ClassifiedError, onRetry?, onSettings?` | Search, Chat |
| `LoadingDots` | (none) | Chat streaming |
| `SourceChips` | `sources: ChatSource[], onOpen: (path) => void` | Chat, Search |
| `MarkdownContent` | `content: string, sourcePath?: string` | Chat, Search snippets |
| `TagChip` | `tag: string, onRemove?: () => void` | Search |

## CSS Module Strategy

### Migration Path

1. Existing `styles.css` stays as-is initially (global styles)
2. New React components use `.module.css` files
3. Gradually move styles from global to modules as components are migrated
4. Obsidian CSS variables (`var(--*)`) used throughout — no custom color values

### Example Module

```css
/* search.module.css */
.searchArea {
  padding: var(--size-4-2);
}

.inputWrapper {
  display: flex;
  align-items: center;
  background: var(--background-modifier-form-field);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
}

.searchInput {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text-normal);
  font-size: var(--font-ui-small);
}
```

## Animation Additions

All CSS-only, no external libraries:

```css
/* Sync spinner */
@keyframes lumen-spin {
  to { transform: rotate(360deg); }
}
.lumen-sync-active .lumen-sync-icon svg {
  animation: lumen-spin 1s linear infinite;
}

/* Success checkmark */
@keyframes lumen-check {
  0% { transform: scale(0); opacity: 0; }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); opacity: 1; }
}

/* Message fade-in */
@keyframes lumen-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.lumen-chat-message { animation: lumen-fade-in 0.2s ease-out; }

/* Error shake */
@keyframes lumen-shake {
  10%, 90% { transform: translateX(-1px); }
  20%, 80% { transform: translateX(2px); }
  30%, 50%, 70% { transform: translateX(-4px); }
  40%, 60% { transform: translateX(4px); }
}
```

## Mobile Considerations

1. **Touch targets**: All interactive elements minimum 44x44px (Apple HIG)
2. **Keyboard handling**: `chatInput` auto-resizes, virtual keyboard doesn't obscure input
3. **Scroll behavior**: `overscroll-behavior: contain` on message containers
4. **Performance**: React's virtual DOM is efficient on mobile; no additional optimization needed for our component tree size (~30 components max)
5. **Platform detection**: `Platform.isMobile` from Obsidian to adjust compact layouts

## Testing Strategy

1. **Existing tests pass unchanged** — they mock `obsidian` module, test pure logic
2. **New React component tests** with Vitest + React Testing Library:
   - `SearchView` renders results from mock API
   - `ChatView` handles streaming tokens
   - `useSearch` hook debounces correctly
   - `useChat` hook manages conversation state
3. **Integration**: Manual testing in Obsidian (desktop + mobile)

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| `MarkdownRenderer.render()` in React | Proven pattern: `useRef` + `useEffect`, already used by Copilot and other React-based plugins |
| Event listener cleanup | React's `useEffect` cleanup handles this naturally; `ItemView.onClose()` unmounts the root |
| Theme compatibility | All CSS uses `var(--*)` Obsidian variables — zero hardcoded colors |
| Bundle size | React 18 = ~42KB gzipped. Total plugin size increase from ~60KB to ~102KB. Well within norms. |
| Migration stalls | Each step (shell → search → chat → shared) is independently functional. Can ship at any step. |

## Estimated Timeline

| Step | Duration | Deliverable |
|------|----------|------------|
| Build system + deps | 0.5 days | JSX compiles, React bundled |
| React shell + scaffold | 1 day | Tab bar works, views are placeholder |
| Search view | 2-3 days | Full search with tags, results, errors |
| Chat view | 3-4 days | Full chat with streaming, conversations |
| Shared components | 1 day | Reusable EmptyState, ErrorState, etc. |
| **Total** | **7.5-9.5 days** | Complete sidebar in React |
