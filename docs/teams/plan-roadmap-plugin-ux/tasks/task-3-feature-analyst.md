---
team: plan-roadmap-plugin-ux
task: 3
author: feature-analyst
status: complete
created: 2026-02-25
---

# Task 3: Competitive Analysis & Feature Recommendations

## Competitive Landscape

### Top AI/Search Obsidian Plugins

| Plugin | Stars | Key Differentiator | UX Pattern Worth Noting |
|--------|-------|-------------------|------------------------|
| **Omnisearch** | 1.6K+ | Local full-text + vault search | Instant results modal, keyboard-first navigation, fuzzy matching |
| **Copilot** | 3K+ | LLM chat in sidebar | Chat + note generation, model selector, conversation persistence |
| **Smart Connections** | 2.5K+ | Local embeddings + backlinks | "Smart View" showing related notes, local-first embeddings |
| **Khoj** | Self-hosted AI | RAG + web search + image gen | Multi-modal, conversation context, online/offline toggle |
| **Obsidian AI** | 500+ | LLM integration | Template-based prompts, context injection from active note |

### What Makes Top Plugins Stand Out

1. **Instant, keyboard-first search** (Omnisearch pattern): Modal opens with `Ctrl+O`, results appear as you type, arrow keys navigate, Enter opens. Zero mouse required.

2. **Conversation persistence + history** (Copilot pattern): Users can return to past conversations, see history in a list, continue threads.

3. **Context-aware AI** (Smart Connections pattern): AI automatically sees related notes, not just the current one. Graph-aware recommendations.

4. **First-run magic moment**: The best plugins deliver value within 30 seconds of installation. No configuration = no friction.

5. **Progressive disclosure**: Simple interface by default, power features revealed on demand (keyboard shortcuts, advanced filters, API toggles).

6. **Status transparency**: Users always know what the plugin is doing. Sync status, indexing progress, model health — all visible.

## Lumen's Unique Advantages

Lumen has a **differentiated architecture** that most competitors lack:

1. **Server-side RAG + sync** — Smart Connections and Copilot do embeddings locally (slow, battery-draining on mobile). Lumen syncs to a server with proper pgvector + hybrid BM25/vector search. This means:
   - Instant search (no local embedding computation)
   - Mobile-friendly (no GPU/CPU drain)
   - Cross-device sync (search from any device)

2. **Two-way sync with conflict detection** — No competitor has a proper sync protocol with conflict resolution. This is enterprise-grade functionality.

3. **Server-managed configuration** — Exclude patterns, sync intervals, and feature gates are server-controlled. Users don't need to fiddle with settings.

4. **Plan-gated features** — Deep Research toggle, subscription tiers. Ready for monetization.

5. **Conversations API** — Persistent, server-side conversations with source attribution and scoring. Superior to local-only chat.

## Feature Recommendations

### Tier 1: Quick Wins (1-2 days each, high impact)

#### 1. Quick-Open Search Modal (Omnisearch-style)
**Impact: Very High** | **Effort: 1-2 days**

Register a hotkey command (`Ctrl+Shift+L` or configurable) that opens a floating modal with:
- Instant search input
- Arrow-key result navigation
- Enter to open, Esc to close
- Appears on top of current workspace (not in sidebar)

This is the #1 UX pattern that makes search plugins feel native to Obsidian. The sidebar view is good for extended sessions, but most searches are quick lookups.

#### 2. Onboarding Flow / First-Run Experience
**Impact: High** | **Effort: 1-2 days**

When the plugin loads for the first time (no API key set):
- Show a welcoming empty state in the sidebar with a "Get Started" CTA
- Step 1: "Enter your API key" with a link to the dashboard
- Step 2: "Testing connection..." (auto-test on key entry)
- Step 3: "Syncing vault..." (auto-sync on first connection)
- Step 4: "Ready! Try searching your vault." with a suggested query

Currently the plugin shows "Not configured — Set your API key" which is functional but cold.

#### 3. Active Note Context in Chat
**Impact: High** | **Effort: 1 day**

When the user has a note open and starts a chat, automatically include context:
- "Regarding `[[Current Note Title]]`:" prefix
- Or a toggle: "Include active note as context"
- Pass the active file path to the conversation API

This is the #1 feature request in AI plugin reviews. Users want to ask "explain this" or "summarize this section" without manually pasting content.

#### 4. Keyboard Shortcuts / Command Palette Integration
**Impact: Medium-High** | **Effort: 0.5 days**

Current commands:
- `Open Lumen` (exists)
- `Sync vault with Lumen` (exists)
- `View documentation` (exists)
- `Open Debug Log` (exists)
- `Find similar notes` (exists)

Missing commands that power users expect:
- `Focus search input` (when sidebar is open)
- `Toggle hybrid search`
- `New chat conversation`
- `Toggle between Search and Chat tabs`
- `Quick search` (opens the floating modal from recommendation #1)

### Tier 2: Differentiating Features (3-5 days each)

#### 5. "Related Notes" Sidebar Panel
**Impact: High** | **Effort: 3 days**

A third tab or a hover panel showing notes semantically related to the currently active file. Updates automatically when the user switches notes. This leverages the existing `searchSimilarDocuments` API.

Smart Connections popularized this pattern, but Lumen's server-side embeddings make it faster and more accurate.

#### 6. Inline Search Results Preview
**Impact: Medium-High** | **Effort: 2-3 days**

When hovering over a search result, show a preview popup with:
- Full heading hierarchy
- First 500 chars of content (formatted markdown)
- Tags, backlinks count
- "Open in new pane" / "Open to the right" options

Currently, clicking a result opens it (replacing the current view). A preview reduces context-switching.

#### 7. Search History & Saved Searches
**Impact: Medium** | **Effort: 2 days**

- Recent searches dropdown (last 20 queries, stored in settings)
- "Save this search" button that bookmarks a query + filters
- Saved searches appear in the command palette

#### 8. Sync Conflict Resolution UI
**Impact: Medium** | **Effort: 3-4 days**

When conflicts are detected during sync:
- Show a notification with "N conflicts detected — Review"
- Open a modal showing each conflict with a side-by-side diff
- Buttons: "Keep Server", "Keep Local", "Keep Both" (per file)
- Currently conflicts always resolve to server-wins with a log file

### Tier 3: Advanced Features (5+ days)

#### 9. Note Generation / AI Writing
**Impact: High** | **Effort: 5-7 days**

- "Generate note from topic" command
- "Expand selection" — AI expands a selected section using vault context
- "Summarize note" — Creates a summary in a callout block
- Template-based generation (meeting notes, research summaries, etc.)

This would require new server endpoints but leverages the existing RAG infrastructure.

#### 10. Graph-Aware Search
**Impact: Medium** | **Effort: 5 days**

Show search results with their position in the knowledge graph:
- "This note is linked to/from N of your search results"
- Cluster related results visually
- Boost results that are graph-connected to recent edits

#### 11. Multi-Vault Support
**Impact: Medium** | **Effort: 5+ days (plugin + server)**

Support searching across multiple synced vaults. The server architecture already supports multiple workspaces — the plugin needs a workspace switcher.

## Onboarding & First-Run UX

### Current First-Run Experience

1. User installs plugin
2. Sidebar shows "Not configured" error state
3. User must go to Settings > Lumen > paste API key > Test Connection
4. No guidance on getting an API key
5. No automatic first sync

### Recommended First-Run Flow

1. User installs plugin
2. Sidebar shows **welcome screen** with Lumen branding and "Get Started"
3. "Get API Key" button links to `https://app.getlumen.dev/settings/api-keys`
4. Input field for API key right in the sidebar (no settings detour)
5. On paste: auto-test connection, auto-resolve workspace ID
6. On success: auto-trigger first sync with progress indicator
7. On sync complete: show "Your vault is indexed! Try searching." with suggested queries

### Empty States

Every state should have a purposeful empty state:
- **Search (no query)**: "Search your vault with natural language" + example queries
- **Search (no results)**: "No results for X" + "Try broader keywords" (exists, good)
- **Chat (no messages)**: "Ask questions about your vault" + suggested prompts (exists, good)
- **Chat (no API key)**: Quick-connect flow, not an error
- **Sync (never synced)**: "Sync your vault to enable search" + "Sync Now" button
- **Sync (offline)**: "You're offline. Sync will resume when connected."

## Mobile-Specific UX

1. **Sync status**: More compact status bar on mobile (icon only, tap for details)
2. **Search**: Larger touch targets for result items
3. **Chat**: Auto-scroll to latest message (already implemented)
4. **Keyboard**: On mobile, search input should auto-focus and show keyboard
5. **Battery awareness**: Reduce sync frequency on low battery (if detectable)
6. **Offline fallback**: Cache last N search results locally for offline access

## Marketplace Readiness Checklist

- [ ] Compelling README with screenshots and feature list
- [ ] Demo GIF showing search + chat in action
- [ ] Proper manifest.json with description, minAppVersion, isDesktopOnly: false
- [ ] Onboarding flow (not just "paste API key in settings")
- [ ] Keyboard shortcuts documented
- [ ] Error messages are user-friendly (not developer-facing)
- [ ] Mobile testing on iOS and Android
- [ ] No console errors in normal operation
- [ ] Settings tab has help text and validation
- [ ] Plugin works gracefully without API key (shows setup guide, doesn't crash)
