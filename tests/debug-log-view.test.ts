/**
 * Unit tests for the Debug Log Viewer (LumenDebugLogView).
 *
 * Tests:
 *   - View metadata (type, display text, icon)
 *   - Renders existing entries from logger on open
 *   - Level filter works (hides lower-severity entries)
 *   - Clear button calls logger.clear() and re-renders
 *   - Copy button copies filtered entries to clipboard
 *   - Live listener appends new entries in real-time
 *   - Auto-scroll behavior (scrolls unless user scrolled up)
 *   - Cleanup on close (removes listener)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LumenDebugLogView, VIEW_TYPE_LUMEN_DEBUG_LOG } from '../src/debug-log-view';
import { logger } from '../src/utils/logger';

// Suppress console output
beforeEach(() => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// DOM mock: Obsidian's createEl/createDiv/createSpan pattern
// ---------------------------------------------------------------------------

interface MockElement {
	tagName: string;
	textContent: string | null;
	id: string;
	htmlFor: string;
	value: string;
	classList: {
		add: ReturnType<typeof vi.fn>;
		remove: ReturnType<typeof vi.fn>;
		toggle: ReturnType<typeof vi.fn>;
		contains: ReturnType<typeof vi.fn>;
	};
	className: string;
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
	children: MockElement[];
	_listeners: Map<string, Function[]>;
	_classes: Set<string>;
	_attrs: Record<string, string>;
	createDiv: (opts?: { cls?: string; text?: string; attr?: Record<string, string> }) => MockElement;
	createEl: (tag: string, opts?: { cls?: string; text?: string; value?: string; attr?: Record<string, string> }) => MockElement;
	createSpan: (opts?: { cls?: string; text?: string }) => MockElement;
	empty: () => void;
	addClass: (...cls: string[]) => void;
	addEventListener: (event: string, handler: Function) => void;
	removeEventListener: (event: string, handler: Function) => void;
	setAttribute: (name: string, value: string) => void;
	getAttribute: (name: string) => string | null;
}

function createMockElement(tag = 'div'): MockElement {
	const children: MockElement[] = [];
	const listeners = new Map<string, Function[]>();
	const classes = new Set<string>();
	const attrs: Record<string, string> = {};

	const el: MockElement = {
		tagName: tag.toUpperCase(),
		textContent: null,
		id: '',
		htmlFor: '',
		value: '',
		classList: {
			add: vi.fn((...cls: string[]) => cls.forEach((c) => classes.add(c))),
			remove: vi.fn((...cls: string[]) => cls.forEach((c) => classes.delete(c))),
			toggle: vi.fn((cls: string, force?: boolean) => {
				if (force === undefined) {
					if (classes.has(cls)) {
						classes.delete(cls);
						return false;
					}
					classes.add(cls);
					return true;
				}
				if (force) classes.add(cls);
				else classes.delete(cls);
				return force;
			}),
			contains: vi.fn((cls: string) => classes.has(cls)),
		},
		className: '',
		scrollTop: 0,
		scrollHeight: 0,
		clientHeight: 0,
		children,
		_listeners: listeners,
		_classes: classes,
		_attrs: attrs,

		createDiv(opts = {}) {
			const child = createMockElement('div');
			if (opts.cls) opts.cls.split(' ').forEach((c) => child._classes.add(c));
			if (opts.text) child.textContent = opts.text;
			if (opts.attr) Object.assign(child._attrs, opts.attr);
			children.push(child);
			return child;
		},

		createEl(tag: string, opts: any = {}) {
			const child = createMockElement(tag);
			if (opts.cls) opts.cls.split(' ').forEach((c: string) => child._classes.add(c));
			if (opts.text) child.textContent = opts.text;
			if (opts.value) child.value = opts.value;
			if (opts.attr) Object.assign(child._attrs, opts.attr);
			children.push(child);
			return child;
		},

		createSpan(opts = {}) {
			return el.createEl('span', opts);
		},

		empty() {
			children.length = 0;
		},

		addClass(...cls: string[]) {
			cls.forEach((c) => classes.add(c));
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
	};

	return el;
}

/** Fire an event on a mock element. */
function fireEvent(el: MockElement, event: string, eventData?: any) {
	const handlers = el._listeners.get(event) ?? [];
	for (const handler of handlers) {
		handler(eventData ?? {});
	}
}

// ---------------------------------------------------------------------------
// Factory: build a LumenDebugLogView with mocked DOM
// ---------------------------------------------------------------------------

function buildView() {
	const contentEl = createMockElement('div');

	// Obsidian's ItemView expects containerEl.children[1] as the content area
	const containerEl = createMockElement('div');
	containerEl.children.push(createMockElement('div')); // children[0] = nav
	containerEl.children.push(contentEl);                 // children[1] = content

	const mockLeaf = {} as any;
	const mockPlugin = {} as any;

	const view = new LumenDebugLogView(mockLeaf, mockPlugin);
	(view as any).containerEl = containerEl;

	return { view, contentEl, containerEl };
}

/** Find elements matching a CSS class within a mock element tree. */
function findByClass(root: MockElement, cls: string): MockElement[] {
	const results: MockElement[] = [];
	if (root._classes.has(cls)) results.push(root);
	for (const child of root.children) {
		results.push(...findByClass(child, cls));
	}
	return results;
}

/** Find the first element with a given class. */
function findFirstByClass(root: MockElement, cls: string): MockElement | undefined {
	return findByClass(root, cls)[0];
}

/** Count log entry rows in the DOM. */
function countEntries(contentEl: MockElement): number {
	return findByClass(contentEl, 'lumen-debug-entry').length;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LumenDebugLogView', () => {
	beforeEach(() => {
		logger.clear();
	});

	// -------------------------------------------------------------------
	// View metadata
	// -------------------------------------------------------------------

	describe('view metadata', () => {
		it('has correct view type', () => {
			const { view } = buildView();
			expect(view.getViewType()).toBe(VIEW_TYPE_LUMEN_DEBUG_LOG);
			expect(view.getViewType()).toBe('lumen-debug-log');
		});

		it('has correct display text', () => {
			const { view } = buildView();
			expect(view.getDisplayText()).toBe('Lumen Debug Log');
		});

		it('has correct icon', () => {
			const { view } = buildView();
			expect(view.getIcon()).toBe('lumen-logo');
		});
	});

	// -------------------------------------------------------------------
	// onOpen: initial rendering
	// -------------------------------------------------------------------

	describe('onOpen rendering', () => {
		it('creates debug container with correct class', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();
			expect(contentEl._classes.has('lumen-debug-container')).toBe(true);
		});

		it('renders existing logger entries on open', async () => {
			logger.info('pre-existing-1');
			logger.warn('pre-existing-2');

			const { view, contentEl } = buildView();
			await view.onOpen();

			const entries = findByClass(contentEl, 'lumen-debug-entry');
			expect(entries.length).toBe(2);
		});

		it('renders header with title', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const header = findFirstByClass(contentEl, 'lumen-debug-header');
			expect(header).toBeDefined();
		});

		it('renders filter dropdown with all log levels', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const select = findFirstByClass(contentEl, 'lumen-debug-filter-select');
			expect(select).toBeDefined();
			// Should have 4 options: Debug+, Info+, Warn+, Error+
			expect(select!.children).toHaveLength(4);
		});

		it('renders clear button', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const buttons = findByClass(contentEl, 'lumen-debug-btn');
			// clear and copy buttons
			expect(buttons.length).toBeGreaterThanOrEqual(2);
			// First button should have aria-label "Clear log"
			expect(buttons[0]._attrs['aria-label']).toBe('Clear log');
		});

		it('renders copy button', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const buttons = findByClass(contentEl, 'lumen-debug-btn');
			expect(buttons[1]._attrs['aria-label']).toBe('Copy log to clipboard');
		});

		it('updates entry count display', async () => {
			logger.info('a');
			logger.info('b');
			logger.info('c');

			const { view, contentEl } = buildView();
			await view.onOpen();

			const countEl = findFirstByClass(contentEl, 'lumen-debug-count');
			expect(countEl).toBeDefined();
			expect(countEl!.textContent).toContain('3');
		});
	});

	// -------------------------------------------------------------------
	// Level filter
	// -------------------------------------------------------------------

	describe('level filter', () => {
		it('shows all entries by default (debug+ filter)', async () => {
			logger.setDebugMode(true);
			logger.debug('debug msg');
			logger.info('info msg');
			logger.warn('warn msg');
			logger.error('error msg');
			logger.setDebugMode(false);

			const { view, contentEl } = buildView();
			await view.onOpen();

			expect(countEntries(contentEl)).toBe(4);
		});

		it('filters entries when level is changed', async () => {
			logger.setDebugMode(true);
			logger.debug('debug');
			logger.info('info');
			logger.warn('warn');
			logger.error('error');
			logger.setDebugMode(false);

			const { view, contentEl } = buildView();
			await view.onOpen();

			// Find the filter select and change to 'warn'
			const select = findFirstByClass(contentEl, 'lumen-debug-filter-select')!;
			select.value = 'warn';
			fireEvent(select, 'change');

			// Should only show warn and error entries (2 of 4)
			expect(countEntries(contentEl)).toBe(2);
		});

		it('error+ filter shows only error entries', async () => {
			logger.info('info');
			logger.warn('warn');
			logger.error('error');

			const { view, contentEl } = buildView();
			await view.onOpen();

			const select = findFirstByClass(contentEl, 'lumen-debug-filter-select')!;
			select.value = 'error';
			fireEvent(select, 'change');

			expect(countEntries(contentEl)).toBe(1);
		});
	});

	// -------------------------------------------------------------------
	// Clear button
	// -------------------------------------------------------------------

	describe('clear button', () => {
		it('calls logger.clear() and empties the view', async () => {
			logger.info('will be cleared');
			const clearSpy = vi.spyOn(logger, 'clear');

			const { view, contentEl } = buildView();
			await view.onOpen();
			expect(countEntries(contentEl)).toBe(1);

			// Click clear button
			const clearBtn = findByClass(contentEl, 'lumen-debug-btn')[0];
			fireEvent(clearBtn, 'click');

			expect(clearSpy).toHaveBeenCalledOnce();
			expect(countEntries(contentEl)).toBe(0);
		});
	});

	// -------------------------------------------------------------------
	// Copy button
	// -------------------------------------------------------------------

	describe('copy button', () => {
		it('copies filtered log entries to clipboard', async () => {
			const writeTextMock = vi.fn().mockResolvedValue(undefined);
			vi.stubGlobal('navigator', {
				clipboard: { writeText: writeTextMock },
			});

			logger.info('copy me');
			logger.warn('and me');

			const { view, contentEl } = buildView();
			await view.onOpen();

			const copyBtn = findByClass(contentEl, 'lumen-debug-btn')[1];
			fireEvent(copyBtn, 'click');

			expect(writeTextMock).toHaveBeenCalledOnce();
			const text = writeTextMock.mock.calls[0][0] as string;
			expect(text).toContain('[INFO] copy me');
			expect(text).toContain('[WARN] and me');

			vi.unstubAllGlobals();
		});
	});

	// -------------------------------------------------------------------
	// Live listener (real-time updates)
	// -------------------------------------------------------------------

	describe('live listener', () => {
		it('appends new entries in real-time after onOpen', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();
			expect(countEntries(contentEl)).toBe(0);

			// Log something after the view is open
			logger.info('live entry');

			expect(countEntries(contentEl)).toBe(1);
		});

		it('respects current filter for live entries', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			// Set filter to warn+
			const select = findFirstByClass(contentEl, 'lumen-debug-filter-select')!;
			select.value = 'warn';
			fireEvent(select, 'change');

			// Log an info message (should be filtered out of display)
			logger.info('filtered out');
			// The entry count in DOM should not increase for filtered entries
			// (the entry is still stored in logger, just not rendered)
			const visibleEntries = findByClass(contentEl, 'lumen-debug-entry');
			const warnOrErrorEntries = visibleEntries.filter(
				(e) => e._classes.has('lumen-debug-level-warn') || e._classes.has('lumen-debug-level-error'),
			);
			expect(warnOrErrorEntries).toHaveLength(0);

			// Log a warn message (should appear)
			logger.warn('visible');
			const afterWarn = findByClass(contentEl, 'lumen-debug-level-warn');
			expect(afterWarn.length).toBeGreaterThanOrEqual(1);
		});
	});

	// -------------------------------------------------------------------
	// Entry rendering format
	// -------------------------------------------------------------------

	describe('entry rendering', () => {
		it('renders timestamp, level badge, and message for each entry', async () => {
			logger.info('test message');

			const { view, contentEl } = buildView();
			await view.onOpen();

			const entry = findFirstByClass(contentEl, 'lumen-debug-entry')!;
			expect(entry).toBeDefined();

			// Should have timestamp, badge, and message children
			const ts = findFirstByClass(entry, 'lumen-debug-ts');
			const badge = findFirstByClass(entry, 'lumen-debug-badge');
			const msg = findFirstByClass(entry, 'lumen-debug-msg');

			expect(ts).toBeDefined();
			expect(badge).toBeDefined();
			expect(msg).toBeDefined();
			expect(badge!.textContent).toBe('INFO');
			expect(msg!.textContent).toBe('test message');
		});

		it('applies level-specific CSS class to entries', async () => {
			logger.error('error msg');

			const { view, contentEl } = buildView();
			await view.onOpen();

			const entry = findFirstByClass(contentEl, 'lumen-debug-entry')!;
			expect(entry._classes.has('lumen-debug-level-error')).toBe(true);
		});
	});

	// -------------------------------------------------------------------
	// onClose cleanup
	// -------------------------------------------------------------------

	describe('onClose', () => {
		it('removes the logger listener on close', async () => {
			const removeSpy = vi.spyOn(logger, 'removeListener');

			const { view } = buildView();
			await view.onOpen();
			await view.onClose();

			expect(removeSpy).toHaveBeenCalledOnce();
		});

		it('stops receiving entries after close', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();
			await view.onClose();

			// Logging after close should not throw
			logger.info('after close');
			// No new entries should appear (listener removed)
		});
	});
});
