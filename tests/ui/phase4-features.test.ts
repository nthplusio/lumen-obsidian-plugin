/**
 * Tests for Phase 4 features — related notes, search history,
 * search preview, and conflict resolution UI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

// ============================================================================
// Related Notes Hook
// ============================================================================

describe('useRelatedNotes', () => {
	const hookSource = () => readFileSync('src/ui/hooks/useRelatedNotes.ts', 'utf-8');

	it('debounce constant is 500ms', () => {
		expect(hookSource()).toContain('const DEBOUNCE_MS = 500');
	});

	it('result limit is 15', () => {
		expect(hookSource()).toContain('const RESULT_LIMIT = 15');
	});

	it('cache max size is 50', () => {
		expect(hookSource()).toContain('size > 50');
	});

	it('tracks active file via workspace event', () => {
		const content = hookSource();
		expect(content).toContain('active-leaf-change');
	});

	it('includes all expected status types', () => {
		const content = hookSource();
		const statuses = ['idle', 'loading', 'done', 'no-results', 'no-file', 'error', 'not-configured'];
		for (const status of statuses) {
			expect(content).toContain(`'${status}'`);
		}
	});
});

// ============================================================================
// Related Notes View
// ============================================================================

describe('RelatedNotesView', () => {
	const viewSource = () => readFileSync('src/ui/components/related/RelatedNotesView.tsx', 'utf-8');

	it('renders a header with active file name', () => {
		const content = viewSource();
		expect(content).toContain('lumen-related-header');
		expect(content).toContain('lumen-related-header-name');
	});

	it('has empty state for no active file', () => {
		const content = viewSource();
		expect(content).toContain('no-file');
	});

	it('renders related items with snippet', () => {
		const content = viewSource();
		expect(content).toContain('lumen-related-item');
		expect(content).toContain('lumen-related-item-snippet');
	});

	it('uses MarkdownRenderer for snippets', () => {
		const content = viewSource();
		expect(content).toContain('MarkdownRenderer.render');
	});
});

// ============================================================================
// TabBar — 3 tabs
// ============================================================================

describe('TabBar', () => {
	const tabBarSource = () => readFileSync('src/ui/components/TabBar.tsx', 'utf-8');

	it('supports search, chat, and related modes', () => {
		const content = tabBarSource();
		expect(content).toContain("'search'");
		expect(content).toContain("'chat'");
		expect(content).toContain("'related'");
	});

	it('exports ViewMode type', () => {
		const content = tabBarSource();
		expect(content).toContain('export type ViewMode');
	});
});

// ============================================================================
// Search History
// ============================================================================

describe('Search history', () => {
	const searchSource = () => readFileSync('src/ui/hooks/useSearch.ts', 'utf-8');
	const viewSource = () => readFileSync('src/ui/components/search/SearchView.tsx', 'utf-8');

	it('MAX_HISTORY constant is 20', () => {
		expect(searchSource()).toContain('const MAX_HISTORY = 20');
	});

	it('has ADD_HISTORY action type', () => {
		expect(searchSource()).toContain("type: 'ADD_HISTORY'");
	});

	it('has SET_HISTORY_OPEN action type', () => {
		expect(searchSource()).toContain("type: 'SET_HISTORY_OPEN'");
	});

	it('records query on successful search', () => {
		const content = searchSource();
		expect(content).toContain("dispatch({ type: 'ADD_HISTORY', query })");
	});

	it('deduplicates and caps history', () => {
		const content = searchSource();
		expect(content).toContain('filter(q => q !== action.query)');
		expect(content).toContain('.slice(0, MAX_HISTORY)');
	});

	it('SearchHistory component exists in SearchView', () => {
		const content = viewSource();
		expect(content).toContain('function SearchHistory');
		expect(content).toContain('lumen-search-history');
	});

	it('history toggle in toolbar', () => {
		const content = viewSource();
		expect(content).toContain('lumen-history-toggle');
		expect(content).toContain('onToggleHistory');
	});
});

// ============================================================================
// Search Result Preview
// ============================================================================

describe('Search result preview', () => {
	const viewSource = () => readFileSync('src/ui/components/search/SearchView.tsx', 'utf-8');

	it('has preview button with panel-right icon', () => {
		const content = viewSource();
		expect(content).toContain('lumen-result-preview-btn');
		expect(content).toContain("'panel-right'");
	});

	it('opens in a split pane', () => {
		const content = viewSource();
		expect(content).toContain("getLeaf('split')");
	});
});

// ============================================================================
// Conflict Resolution UI
// ============================================================================

describe('useConflicts hook', () => {
	const hookSource = () => readFileSync('src/ui/hooks/useConflicts.ts', 'utf-8');

	it('subscribes to plugin conflict changes', () => {
		const content = hookSource();
		expect(content).toContain('onConflictsChange');
	});

	it('provides dismiss action', () => {
		const content = hookSource();
		expect(content).toContain('dismissConflicts');
	});

	it('provides openFile action', () => {
		const content = hookSource();
		expect(content).toContain('openLinkText');
	});

	it('provides openConflictLog action', () => {
		const content = hookSource();
		expect(content).toContain('.lumen-conflicts.md');
	});
});

describe('ConflictBanner component', () => {
	const bannerSource = () => readFileSync('src/ui/components/ConflictBanner.tsx', 'utf-8');

	it('renders warning icon', () => {
		const content = bannerSource();
		expect(content).toContain("'alert-triangle'");
	});

	it('is expandable to show conflict list', () => {
		const content = bannerSource();
		expect(content).toContain('expanded');
		expect(content).toContain('lumen-conflict-list');
	});

	it('shows conflict count in header', () => {
		const content = bannerSource();
		expect(content).toContain('sync conflict');
	});

	it('has dismiss button', () => {
		const content = bannerSource();
		expect(content).toContain('lumen-conflict-dismiss');
		expect(content).toContain('onDismiss');
	});

	it('renders conflict items with path and resolution info', () => {
		const content = bannerSource();
		expect(content).toContain('lumen-conflict-item-path');
		expect(content).toContain('lumen-conflict-item-detail');
		expect(content).toContain('Both modified');
		expect(content).toContain('lumen-conflict-resolve-btn');
	});

	it('has link to full conflict log', () => {
		const content = bannerSource();
		expect(content).toContain('lumen-conflict-log-link');
		expect(content).toContain('View full conflict log');
	});

	it('strips workspace UUID prefix from paths', () => {
		const content = bannerSource();
		expect(content).toContain('[0-9a-f]{8}');
	});

	it('returns null when no conflicts', () => {
		const content = bannerSource();
		expect(content).toContain('if (conflicts.length === 0) return null');
	});
});

describe('Plugin conflict integration', () => {
	const mainSource = () => readFileSync('src/main.ts', 'utf-8');

	it('plugin has unresolvedConflicts array', () => {
		expect(mainSource()).toContain('unresolvedConflicts: UnresolvedConflict[]');
	});

	it('plugin has onConflictsChange subscriber', () => {
		expect(mainSource()).toContain('onConflictsChange');
	});

	it('plugin has dismissConflicts method', () => {
		expect(mainSource()).toContain('dismissConflicts');
	});

	it('onSyncComplete callback surfaces conflicts to UI', () => {
		const content = mainSource();
		expect(content).toContain('result.conflicts');
		expect(content).toContain('notifyConflictListeners');
	});
});

// ============================================================================
// LumenApp wiring
// ============================================================================

describe('LumenApp integration', () => {
	const appSource = () => readFileSync('src/ui/LumenApp.tsx', 'utf-8');

	it('imports and renders ConflictBanner', () => {
		const content = appSource();
		expect(content).toContain("import { ConflictBanner }");
		expect(content).toContain('<ConflictBanner');
	});

	it('renders RelatedNotesView for related mode', () => {
		const content = appSource();
		expect(content).toContain("import { RelatedNotesView }");
		expect(content).toContain('<RelatedNotesView');
	});

	it('ConflictBanner appears above TabBar', () => {
		const content = appSource();
		const bannerIdx = content.indexOf('<ConflictBanner');
		const tabBarIdx = content.indexOf('<TabBar');
		expect(bannerIdx).toBeGreaterThan(-1);
		expect(tabBarIdx).toBeGreaterThan(-1);
		expect(bannerIdx).toBeLessThan(tabBarIdx);
	});
});
