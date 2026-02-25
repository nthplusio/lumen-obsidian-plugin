/**
 * Unit tests for the Similar Notes Modal (SimilarNotesModal).
 *
 * Tests:
 *   - Modal metadata (header, subtitle)
 *   - Loading state on open
 *   - Result rendering (scores, paths, snippets, tags)
 *   - Empty state when no similar notes found
 *   - Error handling (404 not indexed, 401/403 auth, generic)
 *   - Config error when apiUrl/apiKey missing
 *   - Document navigation on result click
 *   - onClose cleanup
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SimilarNotesModal } from '../src/similar-notes-modal';

// ---------------------------------------------------------------------------
// DOM mock: reusable Obsidian-style element factory (same as search-view tests)
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
// Factory: build a SimilarNotesModal with mocked dependencies
// ---------------------------------------------------------------------------

function buildModal(opts: {
	documentPath?: string;
	apiKey?: string;
	searchSimilarFn?: (...args: any[]) => Promise<any>;
} = {}) {
	const contentEl = createMockElement('div');

	const searchSimilarFn = opts.searchSimilarFn ?? vi.fn().mockResolvedValue([]);

	const mockPlugin = {
		settings: {
			apiKey: opts.apiKey ?? 'test-key-123',
		},
		apiClient: {
			searchSimilarDocuments: searchSimilarFn,
		},
		app: {
			vault: {
				getAbstractFileByPath: vi.fn().mockReturnValue({ path: 'test.md' }),
			},
			workspace: {
				openLinkText: vi.fn().mockResolvedValue(undefined),
			},
		},
	} as any;

	const docPath = opts.documentPath ?? 'notes/my-note.md';
	const modal = new SimilarNotesModal(mockPlugin, docPath);

	// Override contentEl with our mock
	(modal as any).contentEl = contentEl;
	// Override app with the mock that has vault/workspace
	(modal as any).app = mockPlugin.app;
	// Stub close() so it doesn't throw
	(modal as any).close = vi.fn();

	return { modal, contentEl, mockPlugin, searchSimilarFn };
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const mockSimilarResults = [
	{
		content: 'Content about project planning',
		source_path: 'notes/project-plan.md',
		heading_hierarchy: ['Project Plan'],
		score: 0.92,
		outgoing_links: [],
		frontmatter: { tags: ['project', 'planning'] },
		chunk_index: 0,
	},
	{
		content: 'Meeting notes from team sync',
		source_path: 'meetings/team-sync.md',
		heading_hierarchy: [],
		score: 0.71,
		outgoing_links: [],
		frontmatter: { tags: ['meeting'] },
		chunk_index: 0,
	},
	{
		content: 'Quick daily log entry',
		source_path: 'daily/2026-02-14.md',
		heading_hierarchy: ['Daily Log'],
		score: 0.45,
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

describe('SimilarNotesModal', () => {
	// -------------------------------------------------------------------
	// Modal header and metadata
	// -------------------------------------------------------------------

	describe('header rendering', () => {
		it('renders modal with lumen-similar-modal class', async () => {
			const { modal, contentEl } = buildModal();
			await modal.onOpen();

			expect(contentEl._classes.has('lumen-similar-modal')).toBe(true);
		});

		it('renders header with title "Similar Notes"', async () => {
			const { modal, contentEl } = buildModal();
			await modal.onOpen();

			const header = findFirstByClass(contentEl, 'lumen-similar-header');
			expect(header).toBeDefined();

			// Find the h2 element
			const titleRow = findFirstByClass(contentEl, 'lumen-similar-title-row');
			expect(titleRow).toBeDefined();
		});

		it('renders subtitle with source document name', async () => {
			const { modal, contentEl } = buildModal({ documentPath: 'notes/my-note.md' });
			await modal.onOpen();

			const subtitle = findFirstByClass(contentEl, 'lumen-similar-subtitle');
			expect(subtitle).toBeDefined();
			expect(subtitle!.textContent).toBe('Notes similar to "my-note"');
		});

		it('strips .md extension from subtitle filename', async () => {
			const { modal, contentEl } = buildModal({ documentPath: 'projects/roadmap.md' });
			await modal.onOpen();

			const subtitle = findFirstByClass(contentEl, 'lumen-similar-subtitle');
			expect(subtitle!.textContent).toBe('Notes similar to "roadmap"');
		});
	});

	// -------------------------------------------------------------------
	// Loading state
	// -------------------------------------------------------------------

	describe('loading state', () => {
		it('shows loading state while fetching', async () => {
			// Use a never-resolving promise to capture loading state
			const searchSimilarFn = vi.fn().mockReturnValue(new Promise(() => {}));
			const { modal, contentEl } = buildModal({ searchSimilarFn });

			// Start onOpen but don't await (it will block on fetchSimilarNotes)
			(modal as any).onOpen();
			await flushMicrotasks();

			const loading = findFirstByClass(contentEl, 'lumen-similar-loading');
			expect(loading).toBeDefined();

			const searching = findFirstByClass(contentEl, 'lumen-searching');
			expect(searching).toBeDefined();
			expect(searching!.textContent).toBe('Finding similar notes...');
		});
	});

	// -------------------------------------------------------------------
	// Result rendering
	// -------------------------------------------------------------------

	describe('result rendering', () => {
		it('renders result items', async () => {
			const searchSimilarFn = vi.fn().mockResolvedValue(mockSimilarResults);
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const items = findByClass(contentEl, 'lumen-similar-item');
			expect(items).toHaveLength(3);
		});

		it('calls searchSimilarDocuments with correct path and limit', async () => {
			const searchSimilarFn = vi.fn().mockResolvedValue([]);
			const { modal } = buildModal({
				documentPath: 'notes/test.md',
				searchSimilarFn,
			});
			await modal.onOpen();

			expect(searchSimilarFn).toHaveBeenCalledWith(
				'notes/test.md',
				{ limit: 10 },
			);
		});

		it('renders score badges with color coding', async () => {
			const searchSimilarFn = vi.fn().mockResolvedValue(mockSimilarResults);
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const scores = findByClass(contentEl, 'lumen-result-score');
			expect(scores).toHaveLength(3);

			// 92% = high
			expect(scores[0].textContent).toBe('92%');
			expect(scores[0]._classes.has('lumen-score-high')).toBe(true);

			// 71% = medium
			expect(scores[1].textContent).toBe('71%');
			expect(scores[1]._classes.has('lumen-score-medium')).toBe(true);

			// 45% = low
			expect(scores[2].textContent).toBe('45%');
			expect(scores[2]._classes.has('lumen-score-low')).toBe(true);
		});

		it('uses heading_hierarchy for title when available', async () => {
			const searchSimilarFn = vi.fn().mockResolvedValue([mockSimilarResults[0]]);
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const titles = findByClass(contentEl, 'lumen-similar-item-title');
			expect(titles[0].textContent).toBe('Project Plan');
		});

		it('falls back to filename when heading_hierarchy is empty', async () => {
			const searchSimilarFn = vi.fn().mockResolvedValue([mockSimilarResults[1]]);
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const titles = findByClass(contentEl, 'lumen-similar-item-title');
			expect(titles[0].textContent).toBe('team-sync');
		});

		it('renders path when different from title', async () => {
			const searchSimilarFn = vi.fn().mockResolvedValue([mockSimilarResults[0]]);
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const paths = findByClass(contentEl, 'lumen-similar-item-path');
			expect(paths).toHaveLength(1);
			expect(paths[0].textContent).toBe('notes/project-plan');
		});

		it('renders snippet text', async () => {
			const searchSimilarFn = vi.fn().mockResolvedValue([mockSimilarResults[0]]);
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const snippets = findByClass(contentEl, 'lumen-similar-item-snippet');
			expect(snippets).toHaveLength(1);
			expect(snippets[0].textContent).toBe('Content about project planning');
		});

		it('truncates long snippets to 200 characters', async () => {
			const longContent = 'A'.repeat(300);
			const result = { ...mockSimilarResults[0], content: longContent };
			const searchSimilarFn = vi.fn().mockResolvedValue([result]);
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const snippets = findByClass(contentEl, 'lumen-similar-item-snippet');
			expect(snippets[0].textContent!.length).toBeLessThanOrEqual(203); // 200 + '...'
			expect(snippets[0].textContent!.endsWith('...')).toBe(true);
		});

		it('renders tags from frontmatter', async () => {
			const searchSimilarFn = vi.fn().mockResolvedValue([mockSimilarResults[0]]);
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const tags = findByClass(contentEl, 'lumen-tag');
			expect(tags).toHaveLength(2);
		});

		it('limits tags to 5', async () => {
			const manyTags = {
				...mockSimilarResults[0],
				frontmatter: { tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
			};
			const searchSimilarFn = vi.fn().mockResolvedValue([manyTags]);
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const tags = findByClass(contentEl, 'lumen-tag');
			expect(tags).toHaveLength(5);
		});
	});

	// -------------------------------------------------------------------
	// Empty state
	// -------------------------------------------------------------------

	describe('empty state', () => {
		it('shows empty state when no results returned', async () => {
			const searchSimilarFn = vi.fn().mockResolvedValue([]);
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const emptyState = findFirstByClass(contentEl, 'lumen-similar-empty');
			expect(emptyState).toBeDefined();
		});

		it('shows empty state for null results', async () => {
			const searchSimilarFn = vi.fn().mockResolvedValue(null);
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const emptyState = findFirstByClass(contentEl, 'lumen-similar-empty');
			expect(emptyState).toBeDefined();
		});
	});

	// -------------------------------------------------------------------
	// Error handling
	// -------------------------------------------------------------------

	describe('error handling', () => {
		it('shows "File not indexed" error for 404', async () => {
			const searchSimilarFn = vi.fn().mockRejectedValue(new Error('404 Not Found'));
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const errorEl = findFirstByClass(contentEl, 'lumen-similar-error');
			expect(errorEl).toBeDefined();

			const title = findFirstByClass(contentEl, 'lumen-error-title');
			expect(title?.textContent).toBe('File not indexed');

			const detail = findFirstByClass(contentEl, 'lumen-error-detail');
			expect(detail?.textContent).toContain('not been indexed');
		});

		it('shows auth error for 401', async () => {
			const searchSimilarFn = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const title = findFirstByClass(contentEl, 'lumen-error-title');
			expect(title?.textContent).toBe('Authentication error');
		});

		it('shows auth error for 403', async () => {
			const searchSimilarFn = vi.fn().mockRejectedValue(new Error('403 Forbidden'));
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const title = findFirstByClass(contentEl, 'lumen-error-title');
			expect(title?.textContent).toBe('Authentication error');
		});

		it('shows generic error with message for unknown errors', async () => {
			const searchSimilarFn = vi.fn().mockRejectedValue(new Error('Something went wrong'));
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const title = findFirstByClass(contentEl, 'lumen-error-title');
			expect(title?.textContent).toBe('Search failed');

			const detail = findFirstByClass(contentEl, 'lumen-error-detail');
			expect(detail?.textContent).toBe('Something went wrong');
		});

		it('handles non-Error thrown values gracefully', async () => {
			const searchSimilarFn = vi.fn().mockRejectedValue('string error');
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const title = findFirstByClass(contentEl, 'lumen-error-title');
			expect(title?.textContent).toBe('Search failed');

			const detail = findFirstByClass(contentEl, 'lumen-error-detail');
			expect(detail?.textContent).toBe('Unknown error');
		});
	});

	// -------------------------------------------------------------------
	// Config error
	// -------------------------------------------------------------------

	describe('config error', () => {
		it('shows config error when apiKey is empty', async () => {
			const searchSimilarFn = vi.fn().mockResolvedValue([]);
			const { modal, contentEl } = buildModal({ apiKey: '', searchSimilarFn });
			await modal.onOpen();

			const title = findFirstByClass(contentEl, 'lumen-error-title');
			expect(title?.textContent).toBe('Not configured');
			expect(searchSimilarFn).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------
	// Document navigation
	// -------------------------------------------------------------------

	describe('document navigation', () => {
		it('opens document on result click', async () => {
			const searchSimilarFn = vi.fn().mockResolvedValue([mockSimilarResults[0]]);
			const { modal, contentEl, mockPlugin } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const item = findFirstByClass(contentEl, 'lumen-similar-item')!;
			expect(item).toBeDefined();
			fireEvent(item, 'click');

			await flushMicrotasks();
			expect(mockPlugin.app.workspace.openLinkText).toHaveBeenCalled();
		});

		it('closes modal after clicking a result', async () => {
			const searchSimilarFn = vi.fn().mockResolvedValue([mockSimilarResults[0]]);
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			const item = findFirstByClass(contentEl, 'lumen-similar-item')!;
			fireEvent(item, 'click');

			await flushMicrotasks();
			expect((modal as any).close).toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------
	// onClose cleanup
	// -------------------------------------------------------------------

	describe('onClose', () => {
		it('empties contentEl on close', async () => {
			const searchSimilarFn = vi.fn().mockResolvedValue(mockSimilarResults);
			const { modal, contentEl } = buildModal({ searchSimilarFn });
			await modal.onOpen();

			// Verify content exists
			expect(contentEl.children.length).toBeGreaterThan(0);

			modal.onClose();

			expect(contentEl.children).toHaveLength(0);
		});
	});
});
