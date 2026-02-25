---
team: plan-roadmap-plugin-ux
task: 7
author: feature-analyst
status: complete
created: 2026-02-25
---

# Task 7: Detailed Feature Recommendations

## Phase Mapping

Per the approved ordering:
- **Phase 3**: UX Features (after React migration)
- **Phase 4**: Differentiating Features

Features are designed to take advantage of the React component system from Phase 2.

## Phase 3: UX Features (5-7 days total)

### 3.1 — Onboarding / First-Run Experience (1-2 days)

**User Impact: High** — Directly affects conversion from install to active user.

**Design:**

Replace the current "Not configured" error state with a welcoming onboarding flow.

```tsx
function OnboardingFlow() {
  const { plugin } = usePlugin();
  const [step, setStep] = useState<'welcome' | 'apikey' | 'connecting' | 'syncing' | 'ready'>('welcome');
  const [apiKey, setApiKey] = useState('');

  return (
    <div className="lumen-onboarding">
      {step === 'welcome' && (
        <WelcomeStep onGetStarted={() => setStep('apikey')} />
      )}
      {step === 'apikey' && (
        <ApiKeyStep value={apiKey} onChange={setApiKey} onSubmit={handleConnect} />
      )}
      {step === 'connecting' && <ConnectingStep />}
      {step === 'syncing' && <SyncingStep progress={...} />}
      {step === 'ready' && <ReadyStep onSearch={...} />}
    </div>
  );
}
```

**Welcome step** shows:
- Lumen flame icon (large, centered)
- "Your vault, illuminated" tagline
- "Lumen adds AI-powered semantic search and chat to your vault."
- [Get Started] button

**API key step** shows:
- Input field (password type, `vr_...` placeholder)
- "Get your API key" link to `https://app.getlumen.dev/settings/api-keys`
- [Connect] button (disabled until input looks like `vr_*`)

**Connecting step** shows:
- Spinner
- "Connecting to Lumen..."
- Auto-tests connection, auto-resolves workspace ID

**Syncing step** shows:
- Progress bar with file count
- "Syncing your vault... (42/120 files)"
- Estimated time remaining

**Ready step** shows:
- Success checkmark animation
- "Your vault is ready!"
- Three suggested search queries (same as current chat empty state)
- "Try a search" button that focuses search input

**Trigger:** Show onboarding when `!settings.apiKey`. Show it in the sidebar view, not a modal (less disruptive).

**Effort estimate:** 1-2 days (1 day for the flow, 0.5-1 day for polish + edge cases like invalid key, network error during connect).

### 3.2 — Quick-Open Search Modal (1-2 days)

**User Impact: Very High** — The #1 pattern that makes search plugins feel native.

**Design:**

Register a new command `lumen:quick-search` with a configurable hotkey (default: unset, suggested: `Ctrl+Shift+L`).

```tsx
class QuickSearchModal extends Modal {
  private root: Root | null = null;

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);
    this.root.render(
      <PluginProvider plugin={this.plugin} app={this.app}>
        <QuickSearch onSelect={this.handleSelect} onClose={() => this.close()} />
      </PluginProvider>
    );
  }

  onClose() {
    this.root?.unmount();
  }
}
```

**QuickSearch component:**
- Auto-focused input at top
- Results appear below as user types (debounced 200ms)
- Arrow keys navigate results (highlight with `aria-activedescendant`)
- Enter opens the highlighted result and closes modal
- Escape closes modal
- Shows score badge and file path for each result
- Maximum 10 results (fast, focused)

**Keyboard navigation:**
```tsx
function QuickSearch({ onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      onSelect(results[selectedIndex].source_path);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  // ... search logic, result rendering ...
}
```

**Effort estimate:** 1.5 days (1 day for core, 0.5 day for keyboard nav + polish).

### 3.3 — Active Note Context in Chat (1 day)

**User Impact: High** — Users expect AI to "see" what they're looking at.

**Design:**

Add a context indicator above the chat input:

```tsx
function ActiveNoteContext() {
  const { app } = usePlugin();
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [includeContext, setIncludeContext] = useState(true);

  useEffect(() => {
    // Listen for active file changes
    const handler = () => {
      const file = app.workspace.getActiveFile();
      setActiveFile(file?.path ?? null);
    };
    app.workspace.on('active-leaf-change', handler);
    return () => app.workspace.off('active-leaf-change', handler);
  }, [app]);

  if (!activeFile) return null;

  return (
    <div className="lumen-chat-context-bar">
      <Toggle checked={includeContext} onChange={setIncludeContext} />
      <span>Context: {filenameFromPath(activeFile)}</span>
    </div>
  );
}
```

When `includeContext` is true and user sends a message, prepend context:

```typescript
const contextPrefix = includeContext && activeFile
  ? `[Regarding "${filenameFromPath(activeFile)}" (${activeFile})]\n\n`
  : '';
const fullMessage = contextPrefix + userMessage;
```

The server's RAG pipeline will use the file reference to pull relevant chunks. If the conversation API supports a `context` parameter, use that instead of message prefixing.

**Effort estimate:** 1 day (straightforward with React, active-leaf-change listener is well-documented).

### 3.4 — Additional Keyboard Shortcuts (0.5 days)

**User Impact: Medium-High** — Power users expect keyboard-driven workflows.

**New commands to register in `main.ts`:**

```typescript
// Focus search input when sidebar is open
this.addCommand({
  id: 'focus-search',
  name: 'Focus search input',
  callback: () => {
    this.activateMainView();
    // Emit event that React listens to
    this.app.workspace.trigger('lumen:focus-search');
  },
});

// New chat conversation
this.addCommand({
  id: 'new-chat',
  name: 'New chat conversation',
  callback: () => {
    this.activateMainView();
    this.app.workspace.trigger('lumen:new-chat');
  },
});

// Toggle search/chat tabs
this.addCommand({
  id: 'toggle-tab',
  name: 'Toggle Search / Chat',
  callback: () => {
    this.activateMainView();
    this.app.workspace.trigger('lumen:toggle-tab');
  },
});

// Quick search modal
this.addCommand({
  id: 'quick-search',
  name: 'Quick search',
  callback: () => {
    new QuickSearchModal(this.app, this).open();
  },
});
```

React components listen to these events via `useEffect` + `app.workspace.on(...)`.

**Effort estimate:** 0.5 days (command registration + event wiring).

### 3.5 — Improved Empty States (0.5 days)

**User Impact: Medium** — Better empty states reduce confusion and encourage exploration.

Design a reusable `<EmptyState>` component used across all views:

```tsx
interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  actions?: Array<{ label: string; onClick: () => void }>;
  suggestions?: string[];
  onSuggestionClick?: (suggestion: string) => void;
}
```

Specific empty states:
- **Search (no API key)**: "Connect to Lumen" + [Enter API Key] button (inline, not settings redirect)
- **Search (no query)**: Current design is good, keep
- **Search (no results)**: Current design is good, keep
- **Chat (no API key)**: Same connect flow as search
- **Chat (no messages)**: Current suggestions are good, keep
- **Sync (offline)**: Cloud-off icon + "You're offline. Sync will resume automatically."
- **Sync (never synced)**: "Sync your vault to enable search" + [Sync Now]

**Effort estimate:** 0.5 days (component + 6 variants).

## Phase 4: Differentiating Features (8-12 days total)

### 4.1 — Related Notes Panel (3 days)

**User Impact: High** — Unique selling point leveraging server-side embeddings.

**Design:**

Add a third tab "Related" to the tab bar, or show as an auto-updating section below search results.

```tsx
function RelatedNotesView() {
  const { plugin, app } = usePlugin();
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [relatedNotes, setRelatedNotes] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handler = () => setActiveFile(app.workspace.getActiveFile()?.path ?? null);
    app.workspace.on('active-leaf-change', handler);
    handler(); // Initialize
    return () => app.workspace.off('active-leaf-change', handler);
  }, [app]);

  useEffect(() => {
    if (!activeFile) { setRelatedNotes([]); return; }
    setLoading(true);
    plugin.apiClient.searchSimilarDocuments(activeFile, { limit: 10 })
      .then(setRelatedNotes)
      .catch(() => setRelatedNotes([]))
      .finally(() => setLoading(false));
  }, [activeFile, plugin]);

  // ... render related notes list ...
}
```

**Debounce:** Don't fetch on every rapid file switch. Debounce by 500ms.

**Cache:** Cache results per file path (in-memory, 5-min TTL).

**Effort estimate:** 3 days (2 days core + 1 day polish, caching, tab integration).

### 4.2 — Search Results Preview (2-3 days)

**User Impact: Medium-High** — Reduces context-switching.

**Design:**

On hover (desktop) or long-press (mobile), show a preview popup:

```tsx
function ResultPreview({ result, position }: Props) {
  return (
    <div className="lumen-result-preview" style={{ top: position.top, left: position.left }}>
      <div className="preview-header">
        <h3>{result.heading_hierarchy?.join(' > ') || filenameFromPath(result.source_path)}</h3>
        <span className="preview-score">{Math.round(result.score * 100)}%</span>
      </div>
      <MarkdownContent content={result.content.slice(0, 500)} />
      <div className="preview-actions">
        <button onClick={() => openInCurrentTab(result.source_path)}>Open</button>
        <button onClick={() => openInNewPane(result.source_path)}>Open to the Right</button>
      </div>
    </div>
  );
}
```

**Positioning:** Use a portal to render the popup outside the sidebar, positioned relative to the hovered result. Account for viewport edges.

**Mobile:** Long-press (300ms) instead of hover. Dismiss by tapping elsewhere.

**Effort estimate:** 2.5 days (1.5 days core, 0.5 day positioning/portal, 0.5 day mobile).

### 4.3 — Search History & Saved Searches (2 days)

**User Impact: Medium** — Convenience for repeat queries.

**Design:**

Store in settings:
```typescript
interface LumenSettings {
  // ... existing ...
  searchHistory: string[];        // Last 20 queries (deduped)
  savedSearches: SavedSearch[];   // User-bookmarked queries
}

interface SavedSearch {
  query: string;
  hybridMode: boolean;
  tags: string[];
  label?: string;
}
```

**UI:**
- History dropdown appears when search input is focused and empty
- Each history item has an [x] to remove and a [bookmark] to save
- Saved searches section at the top with labels
- Saved searches also appear in the command palette

**Effort estimate:** 2 days (1 day for history, 1 day for saved searches + command palette).

### 4.4 — Conflict Resolution UI (3-4 days)

**User Impact: Medium** — Professional-grade sync for power users.

**Design:**

When sync detects conflicts, show a Notice with [Review Conflicts] button. Clicking opens a modal:

```tsx
function ConflictResolutionModal({ conflicts }: Props) {
  return (
    <div className="lumen-conflict-modal">
      <h2>{conflicts.length} Conflict(s) Detected</h2>
      {conflicts.map(conflict => (
        <ConflictItem
          key={conflict.path}
          conflict={conflict}
          localContent={...}
          serverContent={...}
          onResolve={(resolution) => handleResolve(conflict.path, resolution)}
        />
      ))}
      <button onClick={resolveAll}>Apply All</button>
    </div>
  );
}

function ConflictItem({ conflict, localContent, serverContent, onResolve }: Props) {
  return (
    <div className="lumen-conflict-item">
      <h3>{conflict.path}</h3>
      <div className="conflict-diff">
        <div className="conflict-local">
          <h4>Your Version</h4>
          <MarkdownContent content={localContent} />
        </div>
        <div className="conflict-server">
          <h4>Server Version</h4>
          <MarkdownContent content={serverContent} />
        </div>
      </div>
      <div className="conflict-actions">
        <button onClick={() => onResolve('local')}>Keep Mine</button>
        <button onClick={() => onResolve('server')}>Keep Server</button>
        <button onClick={() => onResolve('both')}>Keep Both</button>
      </div>
    </div>
  );
}
```

**Server integration:** Requires the server to provide a way to upload the "winning" version after conflict resolution. May need a new endpoint or parameter on the upload endpoint.

**Effort estimate:** 3-4 days (2 days UI, 1 day conflict data flow, 0.5-1 day server integration).

## Feature Dependency Map

```
Phase 3 (after React):
  3.1 Onboarding        → uses React components (EmptyState, etc.)
  3.2 Quick Search Modal → uses React (createRoot in Modal)
  3.3 Active Note Context → uses React ChatView context
  3.4 Keyboard Shortcuts  → mostly main.ts, minimal React
  3.5 Empty States        → shared React component

Phase 4 (after Phase 3):
  4.1 Related Notes       → uses React tab system + usePlugin hook
  4.2 Search Preview      → uses React portal + MarkdownContent
  4.3 Search History      → uses React SearchContext
  4.4 Conflict Resolution → uses React Modal + MarkdownContent
```

All Phase 3-4 features benefit from React's component model. Building them before React would mean imperative DOM construction (more code, harder to maintain, then thrown away during migration). The approved phase ordering correctly sequences React migration before feature work.

## Effort Summary

| Feature | Phase | Days | Depends On |
|---------|-------|------|-----------|
| Onboarding flow | 3 | 1-2 | React scaffold |
| Quick search modal | 3 | 1.5 | React + SearchView |
| Active note context | 3 | 1 | React ChatView |
| Keyboard shortcuts | 3 | 0.5 | React (for events) |
| Improved empty states | 3 | 0.5 | React shared components |
| **Phase 3 total** | | **4.5-5.5** | |
| Related notes panel | 4 | 3 | React tab system |
| Search preview | 4 | 2.5 | React + portal |
| Search history | 4 | 2 | React SearchContext |
| Conflict resolution | 4 | 3-4 | React + server changes |
| **Phase 4 total** | | **10.5-11.5** | |
