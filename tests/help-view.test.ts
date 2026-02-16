/**
 * Unit tests for the Help View (LumenHelpView).
 *
 * Tests:
 *   - View metadata (type, display text, icon)
 *   - All 7 sections render
 *   - TOC links call scrollIntoView on the target section
 *   - Collapsible sections toggle on header click
 *   - Getting Started section defaults to open
 *   - Other sections default to collapsed
 *   - onClose clears sectionMap
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LumenHelpView, VIEW_TYPE_LUMEN_HELP } from '../src/help-view';

// Suppress console output
beforeEach(() => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// DOM mock (same pattern as debug-log-view tests)
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
	children: MockElement[];
	_listeners: Map<string, Function[]>;
	_classes: Set<string>;
	_attrs: Record<string, string>;
	scrollIntoView: ReturnType<typeof vi.fn>;
	createDiv: (opts?: { cls?: string; text?: string; attr?: Record<string, string> }) => MockElement;
	createEl: (tag: string, opts?: any) => MockElement;
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
		children,
		_listeners: listeners,
		_classes: classes,
		_attrs: attrs,
		scrollIntoView: vi.fn(),

		createDiv(opts: any = {}) {
			const child = createMockElement('div');
			if (opts.cls) opts.cls.split(' ').forEach((c: string) => child._classes.add(c));
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

		createSpan(opts: any = {}) {
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

/** Fire a DOM event on a mock element. */
function fireEvent(el: MockElement, event: string, eventData?: any) {
	const handlers = el._listeners.get(event) ?? [];
	for (const handler of handlers) {
		handler(eventData ?? { preventDefault: () => {} });
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function buildView() {
	const contentEl = createMockElement('div');

	const containerEl = createMockElement('div');
	containerEl.children.push(createMockElement('div')); // children[0] = nav
	containerEl.children.push(contentEl);                 // children[1] = content

	const mockLeaf = {} as any;
	const mockPlugin = {} as any;

	const view = new LumenHelpView(mockLeaf, mockPlugin);
	(view as any).containerEl = containerEl;

	return { view, contentEl };
}

/** Recursively find elements matching a CSS class. */
function findByClass(root: MockElement, cls: string): MockElement[] {
	const results: MockElement[] = [];
	if (root._classes.has(cls)) results.push(root);
	for (const child of root.children) {
		results.push(...findByClass(child, cls));
	}
	return results;
}

function findFirstByClass(root: MockElement, cls: string): MockElement | undefined {
	return findByClass(root, cls)[0];
}

/** Find all elements with a given tag name (case-insensitive). */
function findByTag(root: MockElement, tag: string): MockElement[] {
	const results: MockElement[] = [];
	const upperTag = tag.toUpperCase();
	if (root.tagName === upperTag) results.push(root);
	for (const child of root.children) {
		results.push(...findByTag(child, tag));
	}
	return results;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LumenHelpView', () => {
	// -------------------------------------------------------------------
	// View metadata
	// -------------------------------------------------------------------

	describe('view metadata', () => {
		it('has correct view type', () => {
			const { view } = buildView();
			expect(view.getViewType()).toBe(VIEW_TYPE_LUMEN_HELP);
			expect(view.getViewType()).toBe('lumen-help');
		});

		it('has correct display text', () => {
			const { view } = buildView();
			expect(view.getDisplayText()).toBe('Lumen Help');
		});

		it('has correct icon', () => {
			const { view } = buildView();
			expect(view.getIcon()).toBe('lumen-logo');
		});
	});

	// -------------------------------------------------------------------
	// onOpen: container setup
	// -------------------------------------------------------------------

	describe('onOpen container', () => {
		it('adds lumen-help-container class', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();
			expect(contentEl._classes.has('lumen-help-container')).toBe(true);
		});

		it('renders header with title', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const header = findFirstByClass(contentEl, 'lumen-help-header');
			expect(header).toBeDefined();

			// Should have an h2 with "Lumen Help"
			const h2s = findByTag(contentEl, 'h2');
			const titleH2 = h2s.find((h) => h.textContent === 'Lumen Help');
			expect(titleH2).toBeDefined();
		});

		it('renders subtitle paragraph', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const subtitle = findFirstByClass(contentEl, 'lumen-help-subtitle');
			expect(subtitle).toBeDefined();
			expect(subtitle!.textContent).toContain('Everything you need');
		});
	});

	// -------------------------------------------------------------------
	// Table of contents
	// -------------------------------------------------------------------

	describe('table of contents', () => {
		it('renders a TOC with 7 links', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const toc = findFirstByClass(contentEl, 'lumen-help-toc');
			expect(toc).toBeDefined();

			const links = findByClass(toc!, 'lumen-help-toc-link');
			expect(links).toHaveLength(7);
		});

		it('TOC links have correct labels', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const links = findByClass(contentEl, 'lumen-help-toc-link');
			const labels = links.map((l) => l.textContent);

			expect(labels).toContain('Getting Started');
			expect(labels).toContain('Semantic Search');
			expect(labels).toContain('Vault Sync');
			expect(labels).toContain('Configuration');
			expect(labels).toContain('Troubleshooting');
			expect(labels).toContain('Keyboard Shortcuts');
			expect(labels).toContain('Privacy & Security');
		});

		it('TOC link click scrolls to the target section', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const links = findByClass(contentEl, 'lumen-help-toc-link');

			// Click the first link (Getting Started)
			fireEvent(links[0], 'click');

			// The Getting Started section wrapper should have had scrollIntoView called
			const sections = findByClass(contentEl, 'lumen-help-section');
			expect(sections.length).toBeGreaterThanOrEqual(1);
			// At least one section should have been scrolled to
			const scrolled = sections.some((s) => s.scrollIntoView.mock.calls.length > 0);
			expect(scrolled).toBe(true);
		});
	});

	// -------------------------------------------------------------------
	// All 7 sections render
	// -------------------------------------------------------------------

	describe('section rendering', () => {
		it('renders all 7 collapsible sections', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const sections = findByClass(contentEl, 'lumen-help-section');
			expect(sections).toHaveLength(7);
		});

		it('each section has a header and content area', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const sections = findByClass(contentEl, 'lumen-help-section');
			for (const section of sections) {
				const header = findFirstByClass(section, 'lumen-section-header');
				const content = findFirstByClass(section, 'lumen-section-content');
				expect(header).toBeDefined();
				expect(content).toBeDefined();
			}
		});

		it('each section has a chevron icon', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const chevrons = findByClass(contentEl, 'lumen-section-chevron');
			expect(chevrons).toHaveLength(7);
		});
	});

	// -------------------------------------------------------------------
	// Collapsible behavior
	// -------------------------------------------------------------------

	describe('collapsible sections', () => {
		it('Getting Started section defaults to open (no collapsed class)', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			// First section (Getting Started) should be open
			const sections = findByClass(contentEl, 'lumen-help-section');
			const firstContent = findFirstByClass(sections[0], 'lumen-section-content')!;
			expect(firstContent._classes.has('lumen-section-collapsed')).toBe(false);

			// Its chevron should have the open class
			const chevron = findFirstByClass(sections[0], 'lumen-section-chevron')!;
			expect(chevron._classes.has('lumen-section-chevron-open')).toBe(true);
		});

		it('other sections default to collapsed', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const sections = findByClass(contentEl, 'lumen-help-section');
			// Sections 1-6 (index 1 to 6) should be collapsed
			for (let i = 1; i < sections.length; i++) {
				const content = findFirstByClass(sections[i], 'lumen-section-content')!;
				expect(content._classes.has('lumen-section-collapsed')).toBe(true);
			}
		});

		it('clicking a section header toggles collapsed state', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			// Get the second section (Semantic Search, starts collapsed)
			const sections = findByClass(contentEl, 'lumen-help-section');
			const header = findFirstByClass(sections[1], 'lumen-section-header')!;
			const content = findFirstByClass(sections[1], 'lumen-section-content')!;

			// Initially collapsed
			expect(content._classes.has('lumen-section-collapsed')).toBe(true);

			// Click to open
			fireEvent(header, 'click');
			expect(content._classes.has('lumen-section-collapsed')).toBe(false);

			// Click to close again
			fireEvent(header, 'click');
			expect(content._classes.has('lumen-section-collapsed')).toBe(true);
		});
	});

	// -------------------------------------------------------------------
	// Section content
	// -------------------------------------------------------------------

	describe('section content', () => {
		it('Getting Started has ordered list with setup steps', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const sections = findByClass(contentEl, 'lumen-help-section');
			const gettingStarted = findFirstByClass(sections[0], 'lumen-section-content')!;
			const orderedLists = findByTag(gettingStarted, 'ol');
			expect(orderedLists.length).toBeGreaterThanOrEqual(1);
		});

		it('Troubleshooting section has issue entries', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const issues = findByClass(contentEl, 'lumen-help-issue');
			expect(issues.length).toBeGreaterThanOrEqual(5);
		});

		it('each troubleshooting issue has title, cause, and fix', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const issues = findByClass(contentEl, 'lumen-help-issue');
			for (const issue of issues) {
				const title = findFirstByClass(issue, 'lumen-help-issue-title');
				const cause = findFirstByClass(issue, 'lumen-help-issue-cause');
				const fix = findFirstByClass(issue, 'lumen-help-issue-fix');
				expect(title).toBeDefined();
				expect(cause).toBeDefined();
				expect(fix).toBeDefined();
			}
		});

		it('Configuration section has settings table', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const settingsTable = findFirstByClass(contentEl, 'lumen-help-settings-table');
			expect(settingsTable).toBeDefined();

			const rows = findByClass(settingsTable!, 'lumen-help-setting-row');
			expect(rows.length).toBeGreaterThanOrEqual(5);
		});

		it('Keyboard Shortcuts section lists commands', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const shortcuts = findByClass(contentEl, 'lumen-help-shortcut-row');
			expect(shortcuts.length).toBeGreaterThanOrEqual(3);
		});

		it('Privacy section has warning about API key storage', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const warning = findFirstByClass(contentEl, 'lumen-help-warning');
			expect(warning).toBeDefined();
		});

		it('Semantic Search section has score table', async () => {
			const { view, contentEl } = buildView();
			await view.onOpen();

			const scoreTable = findFirstByClass(contentEl, 'lumen-help-score-table');
			expect(scoreTable).toBeDefined();

			const rows = findByClass(scoreTable!, 'lumen-help-score-row');
			expect(rows).toHaveLength(3);
		});
	});

	// -------------------------------------------------------------------
	// onClose
	// -------------------------------------------------------------------

	describe('onClose', () => {
		it('clears the sectionMap', async () => {
			const { view } = buildView();
			await view.onOpen();

			// sectionMap should have entries
			const sectionMap = (view as any).sectionMap as Map<string, any>;
			expect(sectionMap.size).toBe(7);

			await view.onClose();
			expect(sectionMap.size).toBe(0);
		});
	});
});
