/**
 * Integration tests for v1.3 feature flows.
 *
 * Scenarios:
 *   1. Search with tag filter — open panel, select tag, search with tag applied
 *   2. Find Similar Notes — modal opens, fetches results, click navigates
 *   3. Dataview API — createLumenAPI wired to real ApiClient mock
 *   4. Event-driven sync — file change → debounce (60s) → visibility-gated sync
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LumenMainView } from '../../src/main-view';
import { SimilarNotesModal } from '../../src/similar-notes-modal';
import { createLumenAPI } from '../../src/dataview-api';
import { SyncManager } from '../../src/sync/sync-manager';
import { DEFAULT_SETTINGS } from '../../src/types';
import type { LumenSettings, FileManifestEntry } from '../../src/types';

// ---------------------------------------------------------------------------
// Mock obsidian module
// ---------------------------------------------------------------------------

vi.mock('obsidian', () => ({
	Notice: vi.fn(),
	TFile: class TFile {
		path = '';
		name = '';
		extension = 'md';
		stat = { mtime: 0, ctime: 0, size: 0 };
		vault = {};
		parent = null;
		basename = '';
	},
	TAbstractFile: class {},
	Plugin: class {},
	Vault: class {},
	ItemView: class {
		containerEl = { empty: () => {}, createEl: () => ({}) };
		getViewType() { return ''; }
		getDisplayText() { return ''; }
	},
	Modal: class {
		app: unknown;
		contentEl = { empty: () => {}, createEl: () => ({}), createDiv: () => ({}), addClass: () => {} };
		constructor(app: unknown) { this.app = app; }
		open() {}
		close() {}
		onOpen() {}
		onClose() {}
	},
	WorkspaceLeaf: class {},
	normalizePath: (p: string) => p,
	Platform: { isDesktop: true, isMobile: false },
	setIcon: () => {},
	MarkdownRenderer: {
		render: () => Promise.resolve(),
	},
}));

// ---------------------------------------------------------------------------
// DOM mock factory (same pattern as unit tests)
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
	createDiv: (opts?: any) => MockElement;
	createEl: (tag: string, opts?: any) => MockElement;
	createSpan: (opts?: any) => MockElement;
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

function flushMicrotasks(): Promise<void> {
	return new Promise(resolve => resolve());
}

// Global DOM stubs
const mockTreeWalker = { nextNode: () => null };
vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 });

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const mockSearchResults = [
	{
		content: 'Project planning notes',
		source_path: 'notes/project.md',
		heading_hierarchy: ['Project Plan'],
		score: 0.88,
		outgoing_links: [],
		frontmatter: { tags: ['project', 'planning'] },
		chunk_index: 0,
	},
	{
		content: 'Meeting with stakeholders',
		source_path: 'meetings/stakeholders.md',
		heading_hierarchy: ['Stakeholder Meeting'],
		score: 0.72,
		outgoing_links: [],
		frontmatter: { tags: ['meeting'] },
		chunk_index: 0,
	},
];

const mockTags = [
	{ tag: 'project', count: 15 },
	{ tag: 'meeting', count: 8 },
	{ tag: 'daily', count: 42 },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
	vi.restoreAllMocks();
});

// =========================================================================
// 1. Search with tag filter — full flow
// =========================================================================

describe('Integration: Search with tag filter', () => {
	it('filters search results by selected tag end-to-end', async () => {
		vi.useFakeTimers();

		const contentEl = createMockElement('div');
		const containerEl = createMockElement('div');
		containerEl.children.push(createMockElement('div')); // nav
		containerEl.children.push(contentEl);                 // content

		const searchFn = vi.fn().mockResolvedValue(mockSearchResults);
		const listTagsFn = vi.fn().mockResolvedValue(mockTags);

		const mockPlugin = {
			settings: {
				apiUrl: 'http://localhost:8080',
				apiKey: 'test-key-123',
			},
			apiClient: {
				semanticSearch: searchFn,
				testConnection: vi.fn().mockResolvedValue({ status: 'ok', version: '1.3.0' }),
				listTags: listTagsFn,
			},
		} as any;

		vi.stubGlobal('document', {
			createTreeWalker: () => mockTreeWalker,
			createDocumentFragment: () => ({ appendChild: () => {} }),
			createTextNode: (text: string) => ({ textContent: text }),
			createElement: (tag: string) => ({ className: '', textContent: null, appendChild: () => {} }),
		});

		const view = new LumenMainView({} as any, mockPlugin);
		(view as any).containerEl = containerEl;
		(view as any).app = {
			vault: { getAbstractFileByPath: vi.fn().mockReturnValue({ path: 'test.md' }) },
			workspace: { openLinkText: vi.fn().mockResolvedValue(undefined) },
		};

		await view.onOpen();

		// Step 1: Open tag filter panel (fetches tags)
		const tagsBtn = findFirstByClass(contentEl, 'lumen-tags-toggle')!;
		expect(tagsBtn).toBeDefined();
		fireEvent(tagsBtn, 'click');
		await vi.advanceTimersByTimeAsync(0); // flush tag fetch promise

		expect(listTagsFn).toHaveBeenCalledOnce();

		// Step 2: Type in autocomplete and select a tag
		const tagInput = (view as any).tagAutocompleteInput as MockElement;
		tagInput.value = 'project';
		fireEvent(tagInput, 'input');
		await vi.advanceTimersByTimeAsync(300); // debounce

		const dropdownItems = findByClass(contentEl, 'lumen-tag-dropdown-item');
		expect(dropdownItems.length).toBeGreaterThan(0);

		// Click the first suggestion to add tag
		fireEvent(dropdownItems[0], 'click');

		// Verify tag chip rendered
		const chips = findByClass(contentEl, 'lumen-tag-chip');
		expect(chips).toHaveLength(1);

		// Step 3: Type a search query
		const searchInput = (view as any).searchInput as MockElement;
		searchInput.value = 'planning';
		fireEvent(searchInput, 'input');
		await vi.advanceTimersByTimeAsync(300); // search debounce

		// Step 4: Verify search was called with both query and tag filter
		expect(searchFn).toHaveBeenCalledWith('planning', expect.objectContaining({
			tags: ['project'],
			limit: 20,
		}));

		// Step 5: Verify results rendered
		const resultItems = findByClass(contentEl, 'lumen-result-item');
		expect(resultItems).toHaveLength(2);

		vi.useRealTimers();
	});
});

// =========================================================================
// 2. Find Similar Notes — modal flow
// =========================================================================

describe('Integration: Find Similar Notes modal', () => {
	it('opens modal, fetches similar notes, navigates on click', async () => {
		const contentEl = createMockElement('div');
		const similarResults = [
			{
				content: 'Related project notes',
				source_path: 'notes/related-project.md',
				heading_hierarchy: ['Related Project'],
				score: 0.85,
				outgoing_links: [],
				frontmatter: { tags: ['project'] },
				chunk_index: 0,
			},
		];

		const searchSimilarFn = vi.fn().mockResolvedValue(similarResults);

		const mockPlugin = {
			settings: { apiUrl: 'http://localhost:8080', apiKey: 'test-key' },
			apiClient: { searchSimilarDocuments: searchSimilarFn },
			app: {
				vault: { getAbstractFileByPath: vi.fn().mockReturnValue({ path: 'notes/related-project.md' }) },
				workspace: { openLinkText: vi.fn().mockResolvedValue(undefined) },
			},
		} as any;

		const modal = new SimilarNotesModal(mockPlugin, 'notes/my-note.md');
		(modal as any).contentEl = contentEl;
		(modal as any).app = mockPlugin.app;
		(modal as any).close = vi.fn();

		// Step 1: Open modal (triggers fetch)
		await modal.onOpen();

		// Step 2: Verify API called with correct document path
		expect(searchSimilarFn).toHaveBeenCalledWith('notes/my-note.md', { limit: 10 });

		// Step 3: Verify results rendered
		const items = findByClass(contentEl, 'lumen-similar-item');
		expect(items).toHaveLength(1);

		// Verify title
		const titles = findByClass(contentEl, 'lumen-similar-item-title');
		expect(titles[0].textContent).toBe('Related Project');

		// Verify score badge
		const scores = findByClass(contentEl, 'lumen-result-score');
		expect(scores[0].textContent).toBe('85%');
		expect(scores[0]._classes.has('lumen-score-high')).toBe(true);

		// Step 4: Click result to navigate
		fireEvent(items[0], 'click');
		await flushMicrotasks();

		expect(mockPlugin.app.workspace.openLinkText).toHaveBeenCalled();
		expect((modal as any).close).toHaveBeenCalled();
	});

	it('shows error state when file is not indexed (404)', async () => {
		const contentEl = createMockElement('div');
		const searchSimilarFn = vi.fn().mockRejectedValue(new Error('404 Not Found'));

		const mockPlugin = {
			settings: { apiUrl: 'http://localhost:8080', apiKey: 'test-key' },
			apiClient: { searchSimilarDocuments: searchSimilarFn },
			app: { vault: {}, workspace: {} },
		} as any;

		const modal = new SimilarNotesModal(mockPlugin, 'notes/unindexed.md');
		(modal as any).contentEl = contentEl;
		(modal as any).app = mockPlugin.app;
		(modal as any).close = vi.fn();

		await modal.onOpen();

		const errorTitle = findFirstByClass(contentEl, 'lumen-error-title');
		expect(errorTitle?.textContent).toBe('File not indexed');
	});
});

// =========================================================================
// 3. Dataview API — end-to-end with mock client
// =========================================================================

describe('Integration: Dataview API', () => {
	it('search → getSimilar → getTags pipeline works end-to-end', async () => {
		vi.resetModules();
		const { createLumenAPI: freshCreate } = await import('../../src/dataview-api');

		const mockApiClient = {
			semanticSearch: vi.fn().mockResolvedValue(mockSearchResults),
			searchSimilarDocuments: vi.fn().mockResolvedValue([mockSearchResults[0]]),
			listTags: vi.fn().mockResolvedValue(mockTags),
		};

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const api = freshCreate(mockApiClient as any);

		// Step 1: search() with options
		const results = await api.search('project planning', { limit: 5, tags: ['project'] });
		expect(results).toHaveLength(2);
		expect(mockApiClient.semanticSearch).toHaveBeenCalledWith('project planning', {
			limit: 5,
			tags: ['project'],
		});

		// Step 2: getSimilar() with result from step 1
		const similar = await api.getSimilar(results[0].source_path, { limit: 3 });
		expect(similar).toHaveLength(1);
		expect(mockApiClient.searchSimilarDocuments).toHaveBeenCalledWith('notes/project.md', {
			limit: 3,
		});

		// Step 3: getTags() to populate filter
		const tags = await api.getTags();
		expect(tags).toHaveLength(3);
		expect(tags[0].tag).toBe('project');

		// Step 4: Verify experimental warning fired once
		const experimentalWarnings = warnSpy.mock.calls.filter(
			([msg]) => typeof msg === 'string' && msg.includes('EXPERIMENTAL'),
		);
		expect(experimentalWarnings).toHaveLength(1);

		// Step 5: Verify version
		expect(api.version).toBe('1.3.0');
	});
});

// =========================================================================
// 4. Event-driven sync — file change → visibility gate → debounce → sync
// =========================================================================

describe('Integration: Event-driven sync with idle detection', () => {
	let settings: LumenSettings;
	let fileHasher: any;
	let syncClient: any;
	let conflictLogger: any;
	let mockPlugin: any;
	let manager: SyncManager;
	let mockDocument: any;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.useFakeTimers();

		vi.stubGlobal('window', {
			setTimeout: globalThis.setTimeout.bind(globalThis),
			clearTimeout: globalThis.clearTimeout.bind(globalThis),
			setInterval: globalThis.setInterval.bind(globalThis),
			clearInterval: globalThis.clearInterval.bind(globalThis),
		});

		mockDocument = {
			hidden: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		};
		vi.stubGlobal('document', mockDocument);

		settings = {
			...DEFAULT_SETTINGS,
			apiKey: 'test-key',
			workspaceId: 'ws-001',
			deviceId: 'test-device-001',
		};

		fileHasher = {
			hashAllFiles: vi.fn().mockResolvedValue(new Map()),
			hashFile: vi.fn().mockResolvedValue('a'.repeat(64)),
			invalidateCache: vi.fn(),
			get cacheSize() { return 0; },
		};

		syncClient = {
			register: vi.fn(),
			sendManifestV2: vi.fn().mockResolvedValue({
				sync_session_id: 'session-001',
				needed_files: [],
				deleted_files: [],
				new_cursor: 'cursor-new',
				upload_endpoint: '/upload',
				current_seq: 1,
				server_changes: [],
				server_deletions: [],
				conflicts: [],
				download_endpoint: '/api/workspaces/ws-001/sync/download',
			}),
			uploadFiles: vi.fn().mockResolvedValue({
				sync_session_id: 'session-001',
				accepted: 0,
				rejected: 0,
				deduplicated: 0,
				indexing_triggered: false,
				rejected_files: [],
			}),
			downloadFiles: vi.fn().mockResolvedValue({ files: [] }),
			getSyncStatus: vi.fn(),
			updateSettings: vi.fn(),
		};

		conflictLogger = {
			logConflicts: vi.fn().mockResolvedValue(undefined),
		};

		const vaultOn = vi.fn().mockReturnValue({});
		mockPlugin = {
			registerEvent: vi.fn(),
			saveData: vi.fn().mockResolvedValue(undefined),
			app: {
				vault: {
					on: vaultOn,
					off: vi.fn(),
					read: vi.fn().mockResolvedValue('content'),
					create: vi.fn().mockResolvedValue(undefined),
					modify: vi.fn().mockResolvedValue(undefined),
					delete: vi.fn().mockResolvedValue(undefined),
					createFolder: vi.fn().mockResolvedValue(undefined),
					getAbstractFileByPath: vi.fn().mockReturnValue(null),
					getMarkdownFiles: vi.fn().mockReturnValue([]),
					getName: vi.fn().mockReturnValue('test-vault'),
				},
				workspace: {},
			},
			manifest: { version: '1.3.0' },
		};

		manager = new SyncManager(
			mockPlugin as any,
			settings,
			syncClient as any,
			fileHasher as any,
			conflictLogger as any,
		);
		manager.applySyncConfig({ sync_enabled: true, sync_interval_minutes: 5, event_sync_enabled: true });
	});

	afterEach(() => {
		manager?.destroy();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('file change → hidden pause → foreground resume → 60s debounce → sync', async () => {
		await manager.initialize();

		// Step 1: Verify visibility handler registered
		expect(mockDocument.addEventListener).toHaveBeenCalledWith(
			'visibilitychange',
			expect.any(Function),
		);

		// Step 2: Make document hidden before file change
		mockDocument.hidden = true;

		// Step 3: Trigger a vault modify event
		const modifyCall = mockPlugin.app.vault.on.mock.calls.find(
			([name]: [string]) => name === 'modify',
		);
		expect(modifyCall).toBeDefined();
		const modifyHandler = modifyCall[1];

		const mockFile = {
			path: 'notes/edited.md',
			name: 'edited.md',
			basename: 'edited',
			extension: 'md',
			stat: { mtime: Date.now(), ctime: Date.now(), size: 100 },
			vault: {},
			parent: null,
		};
		Object.setPrototypeOf(mockFile, (await import('obsidian')).TFile.prototype);
		modifyHandler(mockFile);

		// Step 4: Even after 65s, sync should NOT fire (document hidden)
		await vi.advanceTimersByTimeAsync(65_000);
		expect(fileHasher.hashAllFiles).not.toHaveBeenCalled();

		// Step 5: Make document visible and invoke the visibility handler
		mockDocument.hidden = false;
		const visCall = mockDocument.addEventListener.mock.calls.find(
			([name]: [string]) => name === 'visibilitychange',
		);
		const visHandler = visCall[1];
		visHandler();

		// Step 6: After 60s debounce from visibility restore, sync should fire
		await vi.advanceTimersByTimeAsync(60_000);
		expect(fileHasher.hashAllFiles).toHaveBeenCalled();
	});

	it('manual syncNow bypasses debounce and idle detection', async () => {
		const hashMap = new Map<string, FileManifestEntry>();
		hashMap.set('notes/manual.md', {
			path: 'notes/manual.md',
			content_hash: 'b'.repeat(64),
			modified_at: new Date().toISOString(),
			size_bytes: 100,
			action: 'add',
		});
		fileHasher.hashAllFiles.mockResolvedValue(hashMap);

		syncClient.sendManifestV2.mockResolvedValue({
			sync_session_id: 'session-manual',
			needed_files: [],
			deleted_files: [],
			new_cursor: 'cursor-manual',
			upload_endpoint: '/upload',
			current_seq: 1,
			server_changes: [],
			server_deletions: [],
			conflicts: [],
			download_endpoint: '/api/workspaces/ws-001/sync/download',
		});

		await manager.initialize();

		// Document is hidden
		mockDocument.hidden = true;

		// syncNow should work regardless of visibility
		const result = await manager.syncNow();

		expect(result.success).toBe(true);
		expect(fileHasher.hashAllFiles).toHaveBeenCalled();
		expect(settings.lastSyncCursor).toBe('cursor-manual');
	});

	it('eventSyncEnabled=false disables visibility-gated sync', async () => {
		manager = new SyncManager(
			mockPlugin as any,
			settings,
			syncClient as any,
			fileHasher as any,
			conflictLogger as any,
		);
		manager.applySyncConfig({ sync_enabled: true, sync_interval_minutes: 5, event_sync_enabled: false });

		await manager.initialize();

		// No visibility handler should be registered
		expect(mockDocument.addEventListener).not.toHaveBeenCalledWith(
			'visibilitychange',
			expect.any(Function),
		);

		// File change should not trigger debounce
		const modifyCall = mockPlugin.app.vault.on.mock.calls.find(
			([name]: [string]) => name === 'modify',
		);
		const modifyHandler = modifyCall[1];
		const mockFile = {
			path: 'notes/test.md',
			name: 'test.md',
			basename: 'test',
			extension: 'md',
			stat: { mtime: Date.now(), ctime: Date.now(), size: 50 },
			vault: {},
			parent: null,
		};
		Object.setPrototypeOf(mockFile, (await import('obsidian')).TFile.prototype);
		modifyHandler(mockFile);

		await vi.advanceTimersByTimeAsync(65_000);
		expect(fileHasher.hashAllFiles).not.toHaveBeenCalled();
	});
});
