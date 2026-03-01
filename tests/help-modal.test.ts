/**
 * Unit tests for the Help Modal (LumenHelpModal).
 *
 * Tests:
 *   - All 13 sections render (data-driven from HELP_SECTIONS)
 *   - TOC links call scrollIntoView on the target section
 *   - Collapsible sections toggle on header click
 *   - Getting Started section defaults to open
 *   - Other sections default to collapsed
 *   - onClose clears sectionMap
 *   - All content block types render correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LumenHelpModal } from '../src/help-modal';
import { HELP_SECTIONS, DOCUMENTED_COMMAND_IDS } from '../src/help-content';

// Suppress console output
beforeEach(() => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// DOM mock (same pattern as help-view tests)
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

function buildModal() {
	const contentEl = createMockElement('div');
	const mockApp = {} as any;

	const modal = new LumenHelpModal(mockApp);
	(modal as any).contentEl = contentEl;

	return { modal, contentEl };
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

const SECTION_COUNT = HELP_SECTIONS.length;

describe('LumenHelpModal', () => {
	// -------------------------------------------------------------------
	// onOpen: container setup
	// -------------------------------------------------------------------

	describe('onOpen container', () => {
		it('adds lumen-help-modal class', () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();
			expect(contentEl._classes.has('lumen-help-modal')).toBe(true);
		});

		it('renders header with title', () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const header = findFirstByClass(contentEl, 'lumen-help-header');
			expect(header).toBeDefined();

			const h2s = findByTag(contentEl, 'h2');
			const titleH2 = h2s.find((h) => h.textContent === 'Lumen Help');
			expect(titleH2).toBeDefined();
		});

		it('renders subtitle paragraph', () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const subtitle = findFirstByClass(contentEl, 'lumen-help-subtitle');
			expect(subtitle).toBeDefined();
			expect(subtitle!.textContent).toContain('Everything you need');
		});
	});

	// -------------------------------------------------------------------
	// Table of contents
	// -------------------------------------------------------------------

	describe('table of contents', () => {
		it(`renders a TOC with ${SECTION_COUNT} links`, () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const toc = findFirstByClass(contentEl, 'lumen-help-toc');
			expect(toc).toBeDefined();

			const links = findByClass(toc!, 'lumen-help-toc-link');
			expect(links).toHaveLength(SECTION_COUNT);
		});

		it('TOC links have correct labels matching HELP_SECTIONS', () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const links = findByClass(contentEl, 'lumen-help-toc-link');
			const labels = links.map((l) => l.textContent);

			for (const section of HELP_SECTIONS) {
				expect(labels).toContain(section.title);
			}
		});

		it('TOC link click scrolls to the target section', () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const links = findByClass(contentEl, 'lumen-help-toc-link');
			fireEvent(links[0], 'click');

			const sections = findByClass(contentEl, 'lumen-help-section');
			expect(sections.length).toBeGreaterThanOrEqual(1);
			const scrolled = sections.some((s) => s.scrollIntoView.mock.calls.length > 0);
			expect(scrolled).toBe(true);
		});
	});

	// -------------------------------------------------------------------
	// All sections render
	// -------------------------------------------------------------------

	describe('section rendering', () => {
		it(`renders all ${SECTION_COUNT} collapsible sections`, () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const sections = findByClass(contentEl, 'lumen-help-section');
			expect(sections).toHaveLength(SECTION_COUNT);
		});

		it('each section has a header and content area', () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const sections = findByClass(contentEl, 'lumen-help-section');
			for (const section of sections) {
				const header = findFirstByClass(section, 'lumen-section-header');
				const content = findFirstByClass(section, 'lumen-section-content');
				expect(header).toBeDefined();
				expect(content).toBeDefined();
			}
		});

		it('each section has a chevron icon', () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const chevrons = findByClass(contentEl, 'lumen-section-chevron');
			expect(chevrons).toHaveLength(SECTION_COUNT);
		});
	});

	// -------------------------------------------------------------------
	// Collapsible behavior
	// -------------------------------------------------------------------

	describe('collapsible sections', () => {
		it('Getting Started section defaults to open (no collapsed class)', () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const sections = findByClass(contentEl, 'lumen-help-section');
			const firstContent = findFirstByClass(sections[0], 'lumen-section-content')!;
			expect(firstContent._classes.has('lumen-section-collapsed')).toBe(false);

			const chevron = findFirstByClass(sections[0], 'lumen-section-chevron')!;
			expect(chevron._classes.has('lumen-section-chevron-open')).toBe(true);
		});

		it('other sections default to collapsed', () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const sections = findByClass(contentEl, 'lumen-help-section');
			for (let i = 1; i < sections.length; i++) {
				const content = findFirstByClass(sections[i], 'lumen-section-content')!;
				expect(content._classes.has('lumen-section-collapsed')).toBe(true);
			}
		});

		it('clicking a section header toggles collapsed state', () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const sections = findByClass(contentEl, 'lumen-help-section');
			const header = findFirstByClass(sections[1], 'lumen-section-header')!;
			const content = findFirstByClass(sections[1], 'lumen-section-content')!;

			expect(content._classes.has('lumen-section-collapsed')).toBe(true);

			fireEvent(header, 'click');
			expect(content._classes.has('lumen-section-collapsed')).toBe(false);

			fireEvent(header, 'click');
			expect(content._classes.has('lumen-section-collapsed')).toBe(true);
		});
	});

	// -------------------------------------------------------------------
	// Section content
	// -------------------------------------------------------------------

	describe('section content', () => {
		it('Troubleshooting section has issue entries', () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const issues = findByClass(contentEl, 'lumen-help-issue');
			expect(issues.length).toBeGreaterThanOrEqual(5);
		});

		it('Configuration section has settings table', () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const settingsTable = findFirstByClass(contentEl, 'lumen-help-settings-table');
			expect(settingsTable).toBeDefined();

			const rows = findByClass(settingsTable!, 'lumen-help-setting-row');
			expect(rows.length).toBeGreaterThanOrEqual(3);
		});

		it('Privacy section has warning about API key storage', () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const warning = findFirstByClass(contentEl, 'lumen-help-warning');
			expect(warning).toBeDefined();
		});

		it('Semantic Search section has score table', () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const scoreTable = findFirstByClass(contentEl, 'lumen-help-score-table');
			expect(scoreTable).toBeDefined();

			const rows = findByClass(scoreTable!, 'lumen-help-score-row');
			expect(rows).toHaveLength(3);
		});

		it('Keyboard Shortcuts section has 12 shortcut rows', () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const shortcutRows = findByClass(contentEl, 'lumen-help-shortcut-row');
			expect(shortcutRows).toHaveLength(12);
		});

		it('Dataview API section has code blocks', () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const codeBlocks = findByClass(contentEl, 'lumen-help-code-block');
			expect(codeBlocks.length).toBeGreaterThanOrEqual(1);
		});

		it('Chat section exists and has content', () => {
			const { modal, contentEl } = buildModal();
			modal.onOpen();

			const chatSection = HELP_SECTIONS.find((s) => s.id === 'chat');
			expect(chatSection).toBeDefined();
			expect(chatSection!.content.length).toBeGreaterThan(0);
		});
	});

	// -------------------------------------------------------------------
	// Help content data integrity
	// -------------------------------------------------------------------

	describe('help content data', () => {
		it('DOCUMENTED_COMMAND_IDS has 12 entries', () => {
			expect(DOCUMENTED_COMMAND_IDS).toHaveLength(12);
		});

		it('all HELP_SECTIONS have unique IDs', () => {
			const ids = HELP_SECTIONS.map((s) => s.id);
			expect(new Set(ids).size).toBe(ids.length);
		});

		it('exactly one section defaults to open', () => {
			const openSections = HELP_SECTIONS.filter((s) => s.defaultOpen);
			expect(openSections).toHaveLength(1);
			expect(openSections[0].id).toBe('getting-started');
		});

		it('every section has at least one content block', () => {
			for (const section of HELP_SECTIONS) {
				expect(section.content.length).toBeGreaterThan(0);
			}
		});
	});

	// -------------------------------------------------------------------
	// onClose
	// -------------------------------------------------------------------

	describe('onClose', () => {
		it('clears the sectionMap', () => {
			const { modal } = buildModal();
			modal.onOpen();

			const sectionMap = (modal as any).sectionMap as Map<string, any>;
			expect(sectionMap.size).toBe(SECTION_COUNT);

			modal.onClose();
			expect(sectionMap.size).toBe(0);
		});
	});
});
