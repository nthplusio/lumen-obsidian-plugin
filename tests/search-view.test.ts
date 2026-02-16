/**
 * Unit tests for the Search Sidebar View (LumenSearchView).
 *
 * Tests:
 *   - View metadata (type, display text, icon)
 *   - onOpen renders search input, status area, and empty state
 *   - Debounce fires search after 300ms
 *   - Empty query clears results
 *   - Config error shown when apiUrl/apiKey missing
 *   - Results rendered with score badges, paths, tags, snippets
 *   - No-results state shown for empty result set
 *   - Error classification (auth, network, server, rate-limit, config, unknown)
 *   - Retry logic for transient errors (server, rate-limit, network)
 *   - Query superseding (stale search results discarded)
 *   - onClose clears debounce timer
 *   - Escape key blurs search input
 *   - Tags filter panel toggle, autocomplete, chips, search integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LumenSearchView, VIEW_TYPE_LUMEN_SEARCH } from '../src/search-view';

// ---------------------------------------------------------------------------
// DOM mock: reusable Obsidian-style element factory
// ---------------------------------------------------------------------------

interface MockElement {
	tagName: string;
	textContent: string | null;
	type: string;
	placeholder: string;
	value: string;
	classList: {
		add: ReturnType<typeof vi.fn>;
		remove: ReturnType<typeof vi.fn>;
		contains: ReturnType<typeof vi.fn>;
	};
	className: string;
	children: MockElement[];
	_listeners: Map<string, Function[]>;
	_classes: Set<string>;
	_attrs: Record<string, string>;
	path?: string;
	createDiv: (opts?: { cls?: string; text?: string }) => MockElement;
	createEl: (tag: string, opts?: any) => MockElement;
	createSpan: (opts?: { cls?: string; text?: string }) => MockElement;
	empty: () => void;
	addClass: (...cls: string[]) => void;
	removeClass: (...cls: string[]) => void;
	addEventListener: (event: string, handler: Function) => void;
	removeEventListener: (event: string, handler: Function) => void;
	setAttribute: (name: string, value: string) => void;
	getAttribute: (name: string) => string | null;
	blur: ReturnType<typeof vi.fn>;
	toggleClass: (cls: string, value: boolean) => void;
}

function createMockElement(tag = 'div'): MockElement {
	const children: MockElement[] = [];
	const listeners = new Map<string, Function[]>();
	const classes = new Set<string>();
	const attrs: Record<string, string> = {};

	const el: MockElement = {
		tagName: tag.toUpperCase(),
		textContent: null,
		type: '',
		placeholder: '',
		value: '',
		classList: {
			add: vi.fn((...cls: string[]) => cls.forEach(c => classes.add(c))),
			remove: vi.fn((...cls: string[]) => cls.forEach(c => classes.delete(c))),
			contains: vi.fn((cls: string) => classes.has(cls)),
		},
		className: '',
		children,
		_listeners: listeners,
		_classes: classes,
		_attrs: attrs,

		createDiv(opts: any = {}) {
			const child = createMockElement('div');
			if (opts.cls) opts.cls.split(' ').forEach((c: string) => child._classes.add(c));
			if (opts.text) child.textContent = opts.text;
			children.push(child);
			return child;
		},

		createEl(tag: string, opts: any = {}) {
			const child = createMockElement(tag);
			if (opts.cls) opts.cls.split(' ').forEach((c: string) => child._classes.add(c));
			if (opts.text) child.textContent = opts.text;
			if (opts.type) child.type = opts.type;
			if (opts.placeholder) child.placeholder = opts.placeholder;
			if (opts.attr) Object.assign(child._attrs, opts.attr);
			children.push(child);
			return child;
		},

		createSpan(opts: any = {}) {
			return el.createEl('span', opts);
		},

		empty() {
			children.length = 0;
		},

		addClass(...cls: string[]) {
			cls.forEach(c => classes.add(c));
		},

		removeClass(...cls: string[]) {
			cls.forEach(c => classes.delete(c));
		},

		addEventListener(event: string, handler: Function) {
			if (!listeners.has(event)) listeners.set(event, []);
			listeners.get(event)!.push(handler);
		},

		removeEventListener(event: string, handler: Function) {
			const handlers = listeners.get(event);
			if (handlers) {
				const idx = handlers.indexOf(handler);
				if (idx !== -1) handlers.splice(idx, 1);
			}
		},

		setAttribute(name: string, value: string) {
			attrs[name] = value;
		},

		getAttribute(name: string) {
			return attrs[name] ?? null;
		},

		blur: vi.fn(),

		toggleClass(cls: string, value: boolean) {
			if (value) classes.add(cls);
			else classes.delete(cls);
		},
	};

	return el;
}

function fireEvent(el: MockElement, event: string, eventData?: any) {
	const handlers = el._listeners.get(event) ?? [];
	for (const handler of handlers) handler(eventData ?? {});
}

function findByClass(root: MockElement, cls: string): MockElement[] {
	const results: MockElement[] = [];
	if (root._classes.has(cls)) results.push(root);
	for (const child of root.children) results.push(...findByClass(child, cls));
	return results;
}

function findFirstByClass(root: MockElement, cls: string): MockElement | undefined {
	return findByClass(root, cls)[0];
}

/** Flush microtasks (Promise.resolve chains) */
function flushMicrotasks(): Promise<void> {
	return new Promise(resolve => resolve());
}

// ---------------------------------------------------------------------------
// Global DOM stubs needed by search-view (Node environment has no document)
// ---------------------------------------------------------------------------

// highlightTermsInElement uses document.createTreeWalker + NodeFilter — stub both
const mockTreeWalker = { nextNode: () => null };
vi.stubGlobal('document', {
	createTreeWalker: () => mockTreeWalker,
	createDocumentFragment: () => ({ appendChild: () => {} }),
	createTextNode: (text: string) => ({ textContent: text }),
	createElement: (tag: string) => ({ className: '', textContent: null, appendChild: () => {} }),
});
vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 });

// ---------------------------------------------------------------------------
// Factory: build a LumenSearchView with mocked dependencies
// ---------------------------------------------------------------------------

function buildView(opts: {
	apiUrl?: string;
	apiKey?: string;
	searchFn?: (...args: any[]) => Promise<any>;
	testConnectionFn?: (...args: any[]) => Promise<any>;
	listTagsFn?: (...args: any[]) => Promise<any>;
} = {}) {
	const contentEl = createMockElement('div');
	const containerEl = createMockElement('div');
	containerEl.children.push(createMockElement('div')); // children[0] = nav
	containerEl.children.push(contentEl);                 // children[1] = content

	const searchFn = opts.searchFn ?? vi.fn().mockResolvedValue([]);

	const testConnectionFn = opts.testConnectionFn ?? vi.fn().mockResolvedValue({
		status: 'ok', version: '1.2.0', uptime_seconds: 3600, components: [], chunk_count: 100,
	});

	const listTagsFn = opts.listTagsFn ?? vi.fn().mockResolvedValue([]);

	const mockPlugin = {
		settings: {
			apiUrl: opts.apiUrl ?? 'http://localhost:8080',
			apiKey: opts.apiKey ?? 'test-key-123',
		},
		apiClient: {
			semanticSearch: searchFn,
			testConnection: testConnectionFn,
			listTags: listTagsFn,
		},
	} as any;

	const mockLeaf = {} as any;
	const view = new LumenSearchView(mockLeaf, mockPlugin);
	(view as any).containerEl = containerEl;

	// Mock app for openDocument and MarkdownRenderer
	(view as any).app = {
		vault: {
			getAbstractFileByPath: vi.fn().mockReturnValue({ path: 'test.md' }),
		},
		workspace: {
			openLinkText: vi.fn().mockResolvedValue(undefined),
		},
	};

	return { view, contentEl, mockPlugin, searchFn, testConnectionFn, listTagsFn };
}

/**
 * Directly invoke the private executeSearch method, bypassing debounce.
 * This lets us test rendering logic without timer complications.
 */
async function executeSearchDirectly(view: LumenSearchView, query: string): Promise<void> {
	await (view as any).executeSearch(query);
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const mockResults = [
	{
		content: 'Some markdown content about testing',
		source_path: 'projects/my-project.md',
		heading_hierarchy: ['My Project'],
		score: 0.85,
		outgoing_links: [],
		frontmatter: { tags: ['project', 'testing'] },
		chunk_index: 0,
	},
	{
		content: 'Another result',
		source_path: 'notes/daily.md',
		heading_hierarchy: [],
		score: 0.42,
		outgoing_links: [],
		frontmatter: {},
		chunk_index: 0,
	},
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
	vi.restoreAllMocks();
});

describe('LumenSearchView', () => {
	// -------------------------------------------------------------------
	// View metadata
	// -------------------------------------------------------------------

	describe('view metadata', () => {
		it('has correct view type', () => {
			const { view } = buildView();
			expect(view.getViewType()).toBe(VIEW_TYPE_LUMEN_SEARCH);
			expect(view.getViewType()).toBe('lumen-search-view');
		});

		it('has correct display text', () => {
			const { view } = buildView();
			expect(view.getDisplayText()).toBe('Lumen Search');
		});

		it('has correct icon', () => {
			const { view } = buildView();
			expect(view.getIcon()).toBe('lumen-search');
		});
	});

	// -------------------------------------------------------------------
	// onOpen: initial rendering
	// -------------------------------------------------------------------

	describe('onOpen rendering', () => {
		it('creates search container with correct class', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();
			expect(contentEl._classes.has('lumen-search-container')).toBe(true);
		});

		it('renders search input area', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const searchArea = findFirstByClass(contentEl, 'lumen-search-area');
			expect(searchArea).toBeDefined();

			const inputWrapper = findFirstByClass(contentEl, 'lumen-input-wrapper');
			expect(inputWrapper).toBeDefined();
		});

		it('renders empty state on open', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const emptyState = findFirstByClass(contentEl, 'lumen-empty-state');
			expect(emptyState).toBeDefined();
		});

		it('renders status container', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const status = findFirstByClass(contentEl, 'lumen-search-status');
			expect(status).toBeDefined();
		});

		it('renders results container', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const results = findFirstByClass(contentEl, 'lumen-results');
			expect(results).toBeDefined();
		});
	});

	// -------------------------------------------------------------------
	// Debounce behavior (uses fake timers)
	// -------------------------------------------------------------------

	describe('debounce', () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it('does not call search immediately on input', async () => {
			const searchFn = vi.fn().mockResolvedValue([]);
			const { view } = buildView({ searchFn });
			await view.onOpen();

			const input = (view as any).searchInput as MockElement;
			input.value = 'test query';
			fireEvent(input, 'input');

			expect(searchFn).not.toHaveBeenCalled();
		});

		it('calls search after 300ms debounce', async () => {
			const searchFn = vi.fn().mockResolvedValue([]);
			const { view } = buildView({ searchFn });
			await view.onOpen();

			const input = (view as any).searchInput as MockElement;
			input.value = 'test query';
			fireEvent(input, 'input');

			await vi.advanceTimersByTimeAsync(300);

			expect(searchFn).toHaveBeenCalledOnce();
			expect(searchFn).toHaveBeenCalledWith('test query', expect.objectContaining({ limit: 20 }));
		});

		it('resets debounce on subsequent input', async () => {
			const searchFn = vi.fn().mockResolvedValue([]);
			const { view } = buildView({ searchFn });
			await view.onOpen();

			const input = (view as any).searchInput as MockElement;

			// First input
			input.value = 'first';
			fireEvent(input, 'input');
			await vi.advanceTimersByTimeAsync(200);

			// Second input before debounce fires
			input.value = 'second';
			fireEvent(input, 'input');
			await vi.advanceTimersByTimeAsync(200);

			// Only 400ms total, first timer cancelled — should not have fired yet
			expect(searchFn).not.toHaveBeenCalled();

			// After full 300ms from second input
			await vi.advanceTimersByTimeAsync(100);

			expect(searchFn).toHaveBeenCalledOnce();
			expect(searchFn).toHaveBeenCalledWith('second', expect.objectContaining({ limit: 20 }));
		});

		it('shows empty state when query is cleared', async () => {
			const searchFn = vi.fn().mockResolvedValue([]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			const input = (view as any).searchInput as MockElement;
			input.value = 'something';
			fireEvent(input, 'input');
			input.value = '';
			fireEvent(input, 'input');

			const emptyState = findFirstByClass(contentEl, 'lumen-empty-state');
			expect(emptyState).toBeDefined();
			expect(searchFn).not.toHaveBeenCalled();
		});

		it('clears debounce timer on close', async () => {
			const searchFn = vi.fn().mockResolvedValue([]);
			const { view } = buildView({ searchFn });
			await view.onOpen();

			const input = (view as any).searchInput as MockElement;
			input.value = 'test';
			fireEvent(input, 'input');

			// Close before debounce fires
			await view.onClose();
			await vi.advanceTimersByTimeAsync(500);

			expect(searchFn).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------
	// Config error (calls executeSearch directly)
	// -------------------------------------------------------------------

	describe('configuration error', () => {
		it('shows config error when apiUrl is empty', async () => {
			const searchFn = vi.fn().mockResolvedValue([]);
			const { view, contentEl } = buildView({ apiUrl: '', searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const errorState = findFirstByClass(contentEl, 'lumen-error-state');
			expect(errorState).toBeDefined();
			expect(searchFn).not.toHaveBeenCalled();
		});

		it('shows config error when apiKey is empty', async () => {
			const searchFn = vi.fn().mockResolvedValue([]);
			const { view, contentEl } = buildView({ apiKey: '', searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const errorState = findFirstByClass(contentEl, 'lumen-error-state');
			expect(errorState).toBeDefined();
		});
	});

	// -------------------------------------------------------------------
	// Result rendering (calls executeSearch directly)
	// -------------------------------------------------------------------

	describe('result rendering', () => {
		it('renders result items', async () => {
			const searchFn = vi.fn().mockResolvedValue(mockResults);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const items = findByClass(contentEl, 'lumen-result-item');
			expect(items).toHaveLength(2);
		});

		it('shows result count in status', async () => {
			const searchFn = vi.fn().mockResolvedValue(mockResults);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const count = findFirstByClass(contentEl, 'lumen-result-count');
			expect(count).toBeDefined();
			expect(count!.textContent).toBe('2 results');
		});

		it('renders singular result count for 1 result', async () => {
			const searchFn = vi.fn().mockResolvedValue([mockResults[0]]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const count = findFirstByClass(contentEl, 'lumen-result-count');
			expect(count!.textContent).toBe('1 result');
		});

		it('renders score badges with color coding', async () => {
			const searchFn = vi.fn().mockResolvedValue(mockResults);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const scores = findByClass(contentEl, 'lumen-result-score');
			expect(scores).toHaveLength(2);

			// 85% = high
			expect(scores[0].textContent).toBe('85%');
			expect(scores[0]._classes.has('lumen-score-high')).toBe(true);

			// 42% = low
			expect(scores[1].textContent).toBe('42%');
			expect(scores[1]._classes.has('lumen-score-low')).toBe(true);
		});

		it('renders medium score for 50-79%', async () => {
			const mediumResult = { ...mockResults[0], score: 0.65 };
			const searchFn = vi.fn().mockResolvedValue([mediumResult]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const scores = findByClass(contentEl, 'lumen-result-score');
			expect(scores[0].textContent).toBe('65%');
			expect(scores[0]._classes.has('lumen-score-medium')).toBe(true);
		});

		it('uses heading_hierarchy for title when available', async () => {
			const searchFn = vi.fn().mockResolvedValue([mockResults[0]]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const titles = findByClass(contentEl, 'lumen-result-title');
			expect(titles[0].textContent).toBe('My Project');
		});

		it('falls back to filename when heading_hierarchy is empty', async () => {
			const searchFn = vi.fn().mockResolvedValue([mockResults[1]]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const titles = findByClass(contentEl, 'lumen-result-title');
			expect(titles[0].textContent).toBe('daily');
		});

		it('renders path when different from title', async () => {
			const searchFn = vi.fn().mockResolvedValue([mockResults[0]]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const paths = findByClass(contentEl, 'lumen-result-path');
			expect(paths).toHaveLength(1);
			expect(paths[0].textContent).toBe('projects/my-project');
		});

		it('renders tags from frontmatter', async () => {
			const searchFn = vi.fn().mockResolvedValue([mockResults[0]]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const tags = findByClass(contentEl, 'lumen-tag');
			expect(tags).toHaveLength(2);
		});

		it('limits tags to 5', async () => {
			const manyTags = {
				...mockResults[0],
				frontmatter: { tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
			};
			const searchFn = vi.fn().mockResolvedValue([manyTags]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const tags = findByClass(contentEl, 'lumen-tag');
			expect(tags).toHaveLength(5);
		});

		it('shows no-results state for empty results', async () => {
			const searchFn = vi.fn().mockResolvedValue([]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'nonexistent');

			const emptyState = findFirstByClass(contentEl, 'lumen-empty-state');
			expect(emptyState).toBeDefined();
		});

		it('shows no-results state for null results', async () => {
			const searchFn = vi.fn().mockResolvedValue(null);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const emptyState = findFirstByClass(contentEl, 'lumen-empty-state');
			expect(emptyState).toBeDefined();
		});

		it('opens document on result click', async () => {
			const searchFn = vi.fn().mockResolvedValue([mockResults[0]]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const item = findFirstByClass(contentEl, 'lumen-result-item')!;
			expect(item).toBeDefined();
			fireEvent(item, 'click');

			await flushMicrotasks();
			const app = (view as any).app;
			expect(app.workspace.openLinkText).toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------
	// Error classification & display (calls executeSearch directly)
	// -------------------------------------------------------------------

	describe('error handling', () => {
		it('shows auth error for 401', async () => {
			const searchFn = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const title = findFirstByClass(contentEl, 'lumen-error-title');
			expect(title?.textContent).toBe('Authentication Error');
		});

		it('shows auth error for 403', async () => {
			const searchFn = vi.fn().mockRejectedValue(new Error('403 Forbidden'));
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const title = findFirstByClass(contentEl, 'lumen-error-title');
			expect(title?.textContent).toBe('Authentication Error');
		});

		it('shows connection error for ECONNREFUSED after retries', async () => {
			const searchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			// ECONNREFUSED is retryable — executeSearch will call delay() which uses setTimeout
			vi.useFakeTimers();
			const promise = executeSearchDirectly(view, 'test');

			// Drain all retry delays
			for (let i = 0; i < 5; i++) {
				await vi.advanceTimersByTimeAsync(5000);
			}
			await promise;
			vi.useRealTimers();

			const title = findFirstByClass(contentEl, 'lumen-error-title');
			expect(title?.textContent).toBe('Connection Error');
		});

		it('shows config error for 404', async () => {
			const searchFn = vi.fn().mockRejectedValue(new Error('404 Not Found'));
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const detail = findFirstByClass(contentEl, 'lumen-error-detail');
			expect(detail?.textContent).toContain('endpoint not found');
		});

		it('shows rate limit error title', async () => {
			const searchFn = vi.fn().mockRejectedValue(new Error('429 Too Many Requests'));
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			vi.useFakeTimers();
			const promise = executeSearchDirectly(view, 'test');
			for (let i = 0; i < 5; i++) {
				await vi.advanceTimersByTimeAsync(5000);
			}
			await promise;
			vi.useRealTimers();

			const title = findFirstByClass(contentEl, 'lumen-error-title');
			expect(title?.textContent).toBe('Rate Limited');
		});

		it('renders retry button for retryable errors after max retries', async () => {
			const searchFn = vi.fn().mockRejectedValue(new Error('500 Internal Server Error'));
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			vi.useFakeTimers();
			const promise = executeSearchDirectly(view, 'test');
			for (let i = 0; i < 5; i++) {
				await vi.advanceTimersByTimeAsync(5000);
			}
			await promise;
			vi.useRealTimers();

			const retryBtn = findFirstByClass(contentEl, 'lumen-retry-button');
			expect(retryBtn).toBeDefined();
		});

		it('renders settings link for auth errors', async () => {
			const searchFn = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const settingsLink = findFirstByClass(contentEl, 'lumen-settings-link');
			expect(settingsLink).toBeDefined();
		});

		it('handles non-Error thrown values gracefully', async () => {
			const searchFn = vi.fn().mockRejectedValue('string error');
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const errorState = findFirstByClass(contentEl, 'lumen-error-state');
			expect(errorState).toBeDefined();
		});

		it('shows server error for ENOTFOUND (not retryable)', async () => {
			const searchFn = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const title = findFirstByClass(contentEl, 'lumen-error-title');
			expect(title?.textContent).toBe('Connection Error');
			// ENOTFOUND is not retryable — should not retry
			expect(searchFn).toHaveBeenCalledTimes(1);
		});
	});

	// -------------------------------------------------------------------
	// Retry logic (uses fake timers)
	// -------------------------------------------------------------------

	describe('retry logic', () => {
		it('retries transient errors up to MAX_RETRIES times', async () => {
			const searchFn = vi.fn().mockRejectedValue(new Error('503 Service Unavailable'));
			const { view } = buildView({ searchFn });
			await view.onOpen();

			vi.useFakeTimers();
			const promise = executeSearchDirectly(view, 'test');
			for (let i = 0; i < 5; i++) {
				await vi.advanceTimersByTimeAsync(5000);
			}
			await promise;
			vi.useRealTimers();

			// Initial + 2 retries = 3 calls
			expect(searchFn).toHaveBeenCalledTimes(3);
		});

		it('does not retry auth errors', async () => {
			const searchFn = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
			const { view } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			expect(searchFn).toHaveBeenCalledTimes(1);
		});

		it('does not retry 404 errors', async () => {
			const searchFn = vi.fn().mockRejectedValue(new Error('404 Not Found'));
			const { view } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			expect(searchFn).toHaveBeenCalledTimes(1);
		});

		it('retries rate-limit errors', async () => {
			const searchFn = vi.fn().mockRejectedValue(new Error('429 Too Many Requests'));
			const { view } = buildView({ searchFn });
			await view.onOpen();

			vi.useFakeTimers();
			const promise = executeSearchDirectly(view, 'test');
			for (let i = 0; i < 5; i++) {
				await vi.advanceTimersByTimeAsync(5000);
			}
			await promise;
			vi.useRealTimers();

			expect(searchFn).toHaveBeenCalledTimes(3);
		});

		it('succeeds on retry if second attempt works', async () => {
			const searchFn = vi.fn()
				.mockRejectedValueOnce(new Error('502 Bad Gateway'))
				.mockResolvedValueOnce([mockResults[0]]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			vi.useFakeTimers();
			const promise = executeSearchDirectly(view, 'test');
			for (let i = 0; i < 5; i++) {
				await vi.advanceTimersByTimeAsync(5000);
			}
			await promise;
			vi.useRealTimers();

			expect(searchFn).toHaveBeenCalledTimes(2);
			const items = findByClass(contentEl, 'lumen-result-item');
			expect(items).toHaveLength(1);
		});
	});

	// -------------------------------------------------------------------
	// Query superseding
	// -------------------------------------------------------------------

	describe('query superseding', () => {
		it('discards results from stale query', async () => {
			// Mock that changes lastQuery mid-flight (simulates a newer query arriving)
			const searchFn = vi.fn().mockImplementation(async () => {
				// Simulate a newer query being typed while this search is in-flight
				(view as any).lastQuery = 'newer query';
				return [mockResults[0]];
			});
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'old query');

			// Results should NOT be rendered because lastQuery was changed during the search
			const items = findByClass(contentEl, 'lumen-result-item');
			expect(items).toHaveLength(0);
		});
	});

	// -------------------------------------------------------------------
	// Keyboard handling
	// -------------------------------------------------------------------

	describe('keyboard handling', () => {
		it('blurs input on Escape key', async () => {
			const { view } = buildView();
			await view.onOpen();

			const input = (view as any).searchInput as MockElement;
			fireEvent(input, 'keydown', { key: 'Escape' });

			expect(input.blur).toHaveBeenCalled();
		});

		it('does not blur on other keys', async () => {
			const { view } = buildView();
			await view.onOpen();

			const input = (view as any).searchInput as MockElement;
			fireEvent(input, 'keydown', { key: 'Enter' });

			expect(input.blur).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------
	// Loading status
	// -------------------------------------------------------------------

	describe('loading status', () => {
		it('shows searching status during request', async () => {
			const searchFn = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			// Start the search but don't await it
			(view as any).executeSearch('test');
			await flushMicrotasks();

			const searching = findFirstByClass(contentEl, 'lumen-searching');
			expect(searching).toBeDefined();
			expect(searching!.textContent).toBe('Searching...');
		});
	});

	// -------------------------------------------------------------------
	// Feature 1: Chunk count badge
	// -------------------------------------------------------------------

	describe('chunk count badge', () => {
		it('renders chunk badge when matching_chunks > 1', async () => {
			const resultWithChunks = { ...mockResults[0], matching_chunks: 3 };
			const searchFn = vi.fn().mockResolvedValue([resultWithChunks]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const chunkBadges = findByClass(contentEl, 'lumen-result-chunks');
			expect(chunkBadges).toHaveLength(1);
			expect(chunkBadges[0].textContent).toBe('3 sections');
		});

		it('does not render chunk badge when matching_chunks is 1', async () => {
			const resultWithOneChunk = { ...mockResults[0], matching_chunks: 1 };
			const searchFn = vi.fn().mockResolvedValue([resultWithOneChunk]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const chunkBadges = findByClass(contentEl, 'lumen-result-chunks');
			expect(chunkBadges).toHaveLength(0);
		});

		it('does not render chunk badge when matching_chunks is undefined', async () => {
			const searchFn = vi.fn().mockResolvedValue([mockResults[0]]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const chunkBadges = findByClass(contentEl, 'lumen-result-chunks');
			expect(chunkBadges).toHaveLength(0);
		});
	});

	// -------------------------------------------------------------------
	// Feature 2: Hybrid search toggle
	// -------------------------------------------------------------------

	describe('hybrid search toggle', () => {
		it('renders hybrid toggle button in search toolbar', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const toolbar = findFirstByClass(contentEl, 'lumen-search-toolbar');
			expect(toolbar).toBeDefined();

			const toggle = findFirstByClass(contentEl, 'lumen-hybrid-toggle');
			expect(toggle).toBeDefined();
		});

		it('starts with hybrid mode disabled', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const toggle = findFirstByClass(contentEl, 'lumen-hybrid-toggle')!;
			expect(toggle._attrs['aria-pressed']).toBe('false');
			expect((view as any).hybridMode).toBe(false);
		});

		it('toggles hybrid mode on click', async () => {
			const searchFn = vi.fn().mockResolvedValue([]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			const toggle = findFirstByClass(contentEl, 'lumen-hybrid-toggle')!;
			fireEvent(toggle, 'click');

			expect((view as any).hybridMode).toBe(true);
			expect(toggle._attrs['aria-pressed']).toBe('true');
			expect(toggle._classes.has('is-active')).toBe(true);
		});

		it('toggles back off on second click', async () => {
			const searchFn = vi.fn().mockResolvedValue([]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			const toggle = findFirstByClass(contentEl, 'lumen-hybrid-toggle')!;
			fireEvent(toggle, 'click');
			fireEvent(toggle, 'click');

			expect((view as any).hybridMode).toBe(false);
			expect(toggle._attrs['aria-pressed']).toBe('false');
			expect(toggle._classes.has('is-active')).toBe(false);
		});

		it('passes hybrid options to API when enabled', async () => {
			const searchFn = vi.fn().mockResolvedValue([]);
			const { view } = buildView({ searchFn });
			await view.onOpen();

			(view as any).hybridMode = true;
			await executeSearchDirectly(view, 'test');

			expect(searchFn).toHaveBeenCalledWith('test', expect.objectContaining({
				hybrid: true,
				bm25_weight: 0.3,
			}));
		});

		it('does not pass hybrid options when disabled', async () => {
			const searchFn = vi.fn().mockResolvedValue([]);
			const { view } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			expect(searchFn).toHaveBeenCalledWith('test', expect.objectContaining({
				hybrid: undefined,
				bm25_weight: undefined,
			}));
		});

		it('re-executes search on toggle when query exists', async () => {
			const searchFn = vi.fn().mockResolvedValue([]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			// Set a query
			(view as any).lastQuery = 'test query';
			const toggle = findFirstByClass(contentEl, 'lumen-hybrid-toggle')!;
			fireEvent(toggle, 'click');

			await flushMicrotasks();

			expect(searchFn).toHaveBeenCalled();
		});

		it('does not re-execute search on toggle when no query', async () => {
			const searchFn = vi.fn().mockResolvedValue([]);
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			const toggle = findFirstByClass(contentEl, 'lumen-hybrid-toggle')!;
			fireEvent(toggle, 'click');

			await flushMicrotasks();

			expect(searchFn).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------
	// Feature 4: Error action buttons
	// -------------------------------------------------------------------

	describe('error action buttons', () => {
		it('renders actions container for errors', async () => {
			const searchFn = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const actions = findFirstByClass(contentEl, 'lumen-error-actions');
			expect(actions).toBeDefined();
		});

		it('renders test connection button for network errors', async () => {
			const searchFn = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const testBtn = findFirstByClass(contentEl, 'lumen-test-button');
			expect(testBtn).toBeDefined();
			expect(testBtn!.textContent).toBe('Test Connection');
		});

		it('renders test connection button for server errors after retries', async () => {
			const searchFn = vi.fn().mockRejectedValue(new Error('500 Internal Server Error'));
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			vi.useFakeTimers();
			const promise = executeSearchDirectly(view, 'test');
			for (let i = 0; i < 5; i++) {
				await vi.advanceTimersByTimeAsync(5000);
			}
			await promise;
			vi.useRealTimers();

			const testBtn = findFirstByClass(contentEl, 'lumen-test-button');
			expect(testBtn).toBeDefined();
		});

		it('does not render test connection button for auth errors', async () => {
			const searchFn = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			await executeSearchDirectly(view, 'test');

			const testBtn = findFirstByClass(contentEl, 'lumen-test-button');
			expect(testBtn).toBeUndefined();
		});

		it('renders both retry and test connection for server errors', async () => {
			const searchFn = vi.fn().mockRejectedValue(new Error('500 Internal Server Error'));
			const { view, contentEl } = buildView({ searchFn });
			await view.onOpen();

			vi.useFakeTimers();
			const promise = executeSearchDirectly(view, 'test');
			for (let i = 0; i < 5; i++) {
				await vi.advanceTimersByTimeAsync(5000);
			}
			await promise;
			vi.useRealTimers();

			const retryBtn = findFirstByClass(contentEl, 'lumen-retry-button');
			const testBtn = findFirstByClass(contentEl, 'lumen-test-button');
			expect(retryBtn).toBeDefined();
			expect(testBtn).toBeDefined();
		});
	});

	// -------------------------------------------------------------------
	// Feature 5: Tags filter
	// -------------------------------------------------------------------

	describe('tags filter', () => {
		const mockTags = [
			{ tag: 'project', count: 15 },
			{ tag: 'meeting', count: 8 },
			{ tag: 'daily', count: 42 },
			{ tag: 'research', count: 5 },
			{ tag: 'personal', count: 3 },
		];

		describe('panel toggle', () => {
			it('renders tags toggle button in search toolbar', async () => {
				const { view, contentEl } = buildView();
				await view.onOpen();

				const toolbar = findFirstByClass(contentEl, 'lumen-search-toolbar');
				expect(toolbar).toBeDefined();

				const tagsBtn = findFirstByClass(contentEl, 'lumen-tags-toggle');
				expect(tagsBtn).toBeDefined();
			});

			it('starts with tag filter panel collapsed', async () => {
				const { view, contentEl } = buildView();
				await view.onOpen();

				const panel = findFirstByClass(contentEl, 'lumen-tag-filter-panel');
				expect(panel).toBeDefined();
				expect(panel!._classes.has('lumen-tag-filter-collapsed')).toBe(true);
			});

			it('toggles tag filter panel open on click', async () => {
				const listTagsFn = vi.fn().mockResolvedValue(mockTags);
				const { view, contentEl } = buildView({ listTagsFn });
				await view.onOpen();

				const tagsBtn = findFirstByClass(contentEl, 'lumen-tags-toggle')!;
				fireEvent(tagsBtn, 'click');
				await flushMicrotasks();

				expect(tagsBtn._attrs['aria-pressed']).toBe('true');
				expect(tagsBtn._classes.has('is-active')).toBe(true);

				const panel = findFirstByClass(contentEl, 'lumen-tag-filter-panel')!;
				expect(panel._classes.has('lumen-tag-filter-collapsed')).toBe(false);
			});

			it('toggles tag filter panel closed on second click', async () => {
				const listTagsFn = vi.fn().mockResolvedValue(mockTags);
				const { view, contentEl } = buildView({ listTagsFn });
				await view.onOpen();

				const tagsBtn = findFirstByClass(contentEl, 'lumen-tags-toggle')!;
				fireEvent(tagsBtn, 'click');
				await flushMicrotasks();
				fireEvent(tagsBtn, 'click');
				await flushMicrotasks();

				expect(tagsBtn._attrs['aria-pressed']).toBe('false');
				expect(tagsBtn._classes.has('is-active')).toBe(false);

				const panel = findFirstByClass(contentEl, 'lumen-tag-filter-panel')!;
				expect(panel._classes.has('lumen-tag-filter-collapsed')).toBe(true);
			});

			it('fetches tags on first open', async () => {
				const listTagsFn = vi.fn().mockResolvedValue(mockTags);
				const { view, contentEl } = buildView({ listTagsFn });
				await view.onOpen();

				const tagsBtn = findFirstByClass(contentEl, 'lumen-tags-toggle')!;
				fireEvent(tagsBtn, 'click');
				await flushMicrotasks();

				expect(listTagsFn).toHaveBeenCalledOnce();
			});

			it('does not re-fetch tags on subsequent opens', async () => {
				const listTagsFn = vi.fn().mockResolvedValue(mockTags);
				const { view, contentEl } = buildView({ listTagsFn });
				await view.onOpen();

				const tagsBtn = findFirstByClass(contentEl, 'lumen-tags-toggle')!;
				// Open
				fireEvent(tagsBtn, 'click');
				await flushMicrotasks();
				// Close
				fireEvent(tagsBtn, 'click');
				await flushMicrotasks();
				// Re-open — should use cache
				fireEvent(tagsBtn, 'click');
				await flushMicrotasks();

				expect(listTagsFn).toHaveBeenCalledOnce();
			});

			it('handles listTags failure gracefully', async () => {
				const listTagsFn = vi.fn().mockRejectedValue(new Error('500'));
				const { view, contentEl } = buildView({ listTagsFn });
				await view.onOpen();

				const tagsBtn = findFirstByClass(contentEl, 'lumen-tags-toggle')!;
				fireEvent(tagsBtn, 'click');
				await flushMicrotasks();

				// Should not throw — panel is still open, cache set to []
				expect((view as any).tagCache).toEqual([]);
			});

			it('does not fetch tags if apiUrl is empty', async () => {
				const listTagsFn = vi.fn().mockResolvedValue(mockTags);
				const { view, contentEl } = buildView({ apiUrl: '', listTagsFn });
				await view.onOpen();

				const tagsBtn = findFirstByClass(contentEl, 'lumen-tags-toggle')!;
				fireEvent(tagsBtn, 'click');
				await flushMicrotasks();

				expect(listTagsFn).not.toHaveBeenCalled();
			});
		});

		describe('autocomplete', () => {
			beforeEach(() => vi.useFakeTimers());
			afterEach(() => vi.useRealTimers());

			it('renders autocomplete input inside tag filter panel', async () => {
				const { view, contentEl } = buildView();
				await view.onOpen();

				const input = findFirstByClass(contentEl, 'lumen-tag-autocomplete-input');
				expect(input).toBeDefined();
			});

			it('shows tag suggestions after 300ms debounce', async () => {
				const listTagsFn = vi.fn().mockResolvedValue(mockTags);
				const { view, contentEl } = buildView({ listTagsFn });
				await view.onOpen();

				// Open panel to populate tagCache
				const tagsBtn = findFirstByClass(contentEl, 'lumen-tags-toggle')!;
				fireEvent(tagsBtn, 'click');
				await vi.advanceTimersByTimeAsync(0); // flush promise

				// Type in the autocomplete input
				const tagInput = (view as any).tagAutocompleteInput as MockElement;
				tagInput.value = 'pro';
				fireEvent(tagInput, 'input');

				// Should not show suggestions immediately
				const dropdownBefore = findFirstByClass(contentEl, 'lumen-tag-dropdown')!;
				expect(dropdownBefore._classes.has('lumen-tag-dropdown-hidden')).toBe(true);

				// After 300ms debounce
				await vi.advanceTimersByTimeAsync(300);

				const dropdown = findFirstByClass(contentEl, 'lumen-tag-dropdown')!;
				expect(dropdown._classes.has('lumen-tag-dropdown-hidden')).toBe(false);

				const items = findByClass(contentEl, 'lumen-tag-dropdown-item');
				expect(items.length).toBeGreaterThan(0);
			});

			it('filters suggestions by query', async () => {
				const listTagsFn = vi.fn().mockResolvedValue(mockTags);
				const { view, contentEl } = buildView({ listTagsFn });
				await view.onOpen();

				const tagsBtn = findFirstByClass(contentEl, 'lumen-tags-toggle')!;
				fireEvent(tagsBtn, 'click');
				await vi.advanceTimersByTimeAsync(0);

				const tagInput = (view as any).tagAutocompleteInput as MockElement;
				tagInput.value = 'meet';
				fireEvent(tagInput, 'input');
				await vi.advanceTimersByTimeAsync(300);

				const items = findByClass(contentEl, 'lumen-tag-dropdown-item');
				expect(items).toHaveLength(1);

				const name = findFirstByClass(items[0], 'lumen-tag-dropdown-name');
				expect(name?.textContent).toBe('meeting');
			});

			it('shows tag count in dropdown items', async () => {
				const listTagsFn = vi.fn().mockResolvedValue(mockTags);
				const { view, contentEl } = buildView({ listTagsFn });
				await view.onOpen();

				const tagsBtn = findFirstByClass(contentEl, 'lumen-tags-toggle')!;
				fireEvent(tagsBtn, 'click');
				await vi.advanceTimersByTimeAsync(0);

				const tagInput = (view as any).tagAutocompleteInput as MockElement;
				tagInput.value = 'daily';
				fireEvent(tagInput, 'input');
				await vi.advanceTimersByTimeAsync(300);

				const items = findByClass(contentEl, 'lumen-tag-dropdown-item');
				expect(items).toHaveLength(1);

				const count = findFirstByClass(items[0], 'lumen-tag-dropdown-count');
				expect(count?.textContent).toBe('42');
			});

			it('limits suggestions to 50 items', async () => {
				const manyTags = Array.from({ length: 100 }, (_, i) => ({
					tag: `tag-${i}`,
					count: i,
				}));
				const listTagsFn = vi.fn().mockResolvedValue(manyTags);
				const { view, contentEl } = buildView({ listTagsFn });
				await view.onOpen();

				const tagsBtn = findFirstByClass(contentEl, 'lumen-tags-toggle')!;
				fireEvent(tagsBtn, 'click');
				await vi.advanceTimersByTimeAsync(0);

				const tagInput = (view as any).tagAutocompleteInput as MockElement;
				tagInput.value = 'tag';
				fireEvent(tagInput, 'input');
				await vi.advanceTimersByTimeAsync(300);

				const items = findByClass(contentEl, 'lumen-tag-dropdown-item');
				expect(items).toHaveLength(50);
			});

			it('hides dropdown when input is cleared', async () => {
				const listTagsFn = vi.fn().mockResolvedValue(mockTags);
				const { view, contentEl } = buildView({ listTagsFn });
				await view.onOpen();

				const tagsBtn = findFirstByClass(contentEl, 'lumen-tags-toggle')!;
				fireEvent(tagsBtn, 'click');
				await vi.advanceTimersByTimeAsync(0);

				const tagInput = (view as any).tagAutocompleteInput as MockElement;
				tagInput.value = 'pro';
				fireEvent(tagInput, 'input');
				await vi.advanceTimersByTimeAsync(300);

				// Clear input
				tagInput.value = '';
				fireEvent(tagInput, 'input');

				const dropdown = findFirstByClass(contentEl, 'lumen-tag-dropdown')!;
				expect(dropdown._classes.has('lumen-tag-dropdown-hidden')).toBe(true);
			});

			it('hides dropdown on Escape key', async () => {
				const listTagsFn = vi.fn().mockResolvedValue(mockTags);
				const { view, contentEl } = buildView({ listTagsFn });
				await view.onOpen();

				const tagsBtn = findFirstByClass(contentEl, 'lumen-tags-toggle')!;
				fireEvent(tagsBtn, 'click');
				await vi.advanceTimersByTimeAsync(0);

				const tagInput = (view as any).tagAutocompleteInput as MockElement;
				tagInput.value = 'pro';
				fireEvent(tagInput, 'input');
				await vi.advanceTimersByTimeAsync(300);

				fireEvent(tagInput, 'keydown', { key: 'Escape' });

				const dropdown = findFirstByClass(contentEl, 'lumen-tag-dropdown')!;
				expect(dropdown._classes.has('lumen-tag-dropdown-hidden')).toBe(true);
			});

			it('excludes already-selected tags from suggestions', async () => {
				const listTagsFn = vi.fn().mockResolvedValue(mockTags);
				const { view, contentEl } = buildView({ listTagsFn });
				await view.onOpen();

				const tagsBtn = findFirstByClass(contentEl, 'lumen-tags-toggle')!;
				fireEvent(tagsBtn, 'click');
				await vi.advanceTimersByTimeAsync(0);

				// Pre-select 'project'
				(view as any).selectedTags = ['project'];

				const tagInput = (view as any).tagAutocompleteInput as MockElement;
				tagInput.value = 'pro';
				fireEvent(tagInput, 'input');
				await vi.advanceTimersByTimeAsync(300);

				// 'project' matches 'pro' but should be excluded since it's selected
				const items = findByClass(contentEl, 'lumen-tag-dropdown-item');
				const names = items.map(item => findFirstByClass(item, 'lumen-tag-dropdown-name')?.textContent);
				expect(names).not.toContain('project');
			});
		});

		describe('tag chips', () => {
			it('adds tag chip when selecting from dropdown', async () => {
				vi.useFakeTimers();
				const listTagsFn = vi.fn().mockResolvedValue(mockTags);
				const { view, contentEl } = buildView({ listTagsFn });
				await view.onOpen();

				const tagsBtn = findFirstByClass(contentEl, 'lumen-tags-toggle')!;
				fireEvent(tagsBtn, 'click');
				await vi.advanceTimersByTimeAsync(0);

				const tagInput = (view as any).tagAutocompleteInput as MockElement;
				tagInput.value = 'project';
				fireEvent(tagInput, 'input');
				await vi.advanceTimersByTimeAsync(300);

				// Click the first dropdown item
				const items = findByClass(contentEl, 'lumen-tag-dropdown-item');
				expect(items.length).toBeGreaterThan(0);
				fireEvent(items[0], 'click');

				// Should render a chip
				const chips = findByClass(contentEl, 'lumen-tag-chip');
				expect(chips).toHaveLength(1);

				// Input should be cleared
				expect(tagInput.value).toBe('');

				vi.useRealTimers();
			});

			it('removes tag chip on remove button click', async () => {
				const { view, contentEl } = buildView();
				await view.onOpen();

				// Manually add a selected tag
				(view as any).selectedTags = ['project'];
				(view as any).renderTagChips();

				const chips = findByClass(contentEl, 'lumen-tag-chip');
				expect(chips).toHaveLength(1);

				// Click the remove button
				const removeBtn = findFirstByClass(chips[0], 'lumen-tag-chip-remove')!;
				fireEvent(removeBtn, 'click', { stopPropagation: () => {} });

				expect((view as any).selectedTags).toEqual([]);
				const chipsAfter = findByClass(contentEl, 'lumen-tag-chip');
				expect(chipsAfter).toHaveLength(0);
			});

			it('does not add duplicate tags', async () => {
				const { view } = buildView();
				await view.onOpen();

				(view as any).selectedTags = ['project'];
				(view as any).addTag('project');

				expect((view as any).selectedTags).toEqual(['project']);
			});
		});

		describe('search integration', () => {
			it('passes selected tags to search API', async () => {
				const searchFn = vi.fn().mockResolvedValue([]);
				const { view } = buildView({ searchFn });
				await view.onOpen();

				(view as any).selectedTags = ['project', 'meeting'];
				await executeSearchDirectly(view, 'test');

				expect(searchFn).toHaveBeenCalledWith('test', expect.objectContaining({
					tags: ['project', 'meeting'],
				}));
			});

			it('does not pass tags when none selected', async () => {
				const searchFn = vi.fn().mockResolvedValue([]);
				const { view } = buildView({ searchFn });
				await view.onOpen();

				await executeSearchDirectly(view, 'test');

				expect(searchFn).toHaveBeenCalledWith('test', expect.objectContaining({
					tags: undefined,
				}));
			});

			it('re-executes search when tag is added and query exists', async () => {
				const searchFn = vi.fn().mockResolvedValue([]);
				const { view } = buildView({ searchFn });
				await view.onOpen();

				(view as any).lastQuery = 'test query';
				(view as any).tagCache = mockTags;
				(view as any).addTag('project');

				await flushMicrotasks();

				expect(searchFn).toHaveBeenCalled();
			});

			it('re-executes search when tag is removed and query exists', async () => {
				const searchFn = vi.fn().mockResolvedValue([]);
				const { view } = buildView({ searchFn });
				await view.onOpen();

				(view as any).selectedTags = ['project'];
				(view as any).lastQuery = 'test query';
				(view as any).removeTag('project');

				await flushMicrotasks();

				expect(searchFn).toHaveBeenCalled();
			});

			it('does not re-execute search when tag added but no query', async () => {
				const searchFn = vi.fn().mockResolvedValue([]);
				const { view } = buildView({ searchFn });
				await view.onOpen();

				(view as any).tagCache = mockTags;
				(view as any).addTag('project');

				await flushMicrotasks();

				expect(searchFn).not.toHaveBeenCalled();
			});
		});

		describe('onClose cleanup', () => {
			it('clears tag debounce timer on close', async () => {
				vi.useFakeTimers();
				const listTagsFn = vi.fn().mockResolvedValue(mockTags);
				const { view, contentEl } = buildView({ listTagsFn });
				await view.onOpen();

				const tagsBtn = findFirstByClass(contentEl, 'lumen-tags-toggle')!;
				fireEvent(tagsBtn, 'click');
				await vi.advanceTimersByTimeAsync(0);

				// Start typing to trigger tag debounce
				const tagInput = (view as any).tagAutocompleteInput as MockElement;
				tagInput.value = 'pro';
				fireEvent(tagInput, 'input');

				// Close before debounce fires
				await view.onClose();
				await vi.advanceTimersByTimeAsync(500);

				// Dropdown should remain hidden (debounce cleared)
				const dropdown = findFirstByClass(contentEl, 'lumen-tag-dropdown')!;
				expect(dropdown._classes.has('lumen-tag-dropdown-hidden')).toBe(true);

				vi.useRealTimers();
			});
		});
	});
});
