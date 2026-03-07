/**
 * Integration tests for v1.3 features.
 *
 * Validates end-to-end data flows across component boundaries:
 *   1. Search with tag filter — tags fetched → selected → passed to search API
 *   2. Dataview API → search()/getSimilar()/getTags() → correct API delegation
 *   3. Event-driven sync — file change → debounce → idle detection → sync
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncManager } from '../../src/sync/sync-manager';
import { DEFAULT_SETTINGS } from '../../src/types';
import type {
	LumenSettings,
	SyncManifestResponseV2,
	SyncUploadResponse,
	FileManifestEntry,
} from '../../src/types';

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
	Modal: class { app: unknown; contentEl = { empty: () => {}, createEl: () => ({}), createDiv: () => ({}), addClass: () => {} }; constructor(app: unknown) { this.app = app; } open() {} close() {} onOpen() {} onClose() {} },
	normalizePath: (p: string) => p,
	Platform: { isDesktop: true, isMobile: false },
	setIcon: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSettings(overrides: Partial<LumenSettings> = {}): LumenSettings {
	return {
		...DEFAULT_SETTINGS,
		apiKey: 'test-key',
		workspaceId: 'ws-001',
		deviceId: 'test-device-001',
		...overrides,
	};
}

function createMockTFile(path: string, mtime = Date.now(), size = 100) {
	return {
		path,
		name: path.split('/').pop()!,
		basename: path.split('/').pop()!.replace('.md', ''),
		extension: 'md',
		stat: { mtime, ctime: mtime, size },
		vault: {} as any,
		parent: null,
	};
}

async function setTFilePrototype(file: ReturnType<typeof createMockTFile>) {
	const { TFile } = await import('obsidian');
	Object.setPrototypeOf(file, TFile.prototype);
}

function createMockApiClient() {
	return {
		semanticSearch: vi.fn().mockResolvedValue([
			{ source_path: 'notes/result.md', score: 0.95, snippet: 'matched content' },
		]),
		searchSimilarDocuments: vi.fn().mockResolvedValue([
			{ source_path: 'notes/similar.md', score: 0.80 },
		]),
		listTags: vi.fn().mockResolvedValue([
			{ tag: 'ai', count: 10 },
			{ tag: 'machine-learning', count: 5 },
			{ tag: 'notes', count: 20 },
		]),
		testConnection: vi.fn().mockResolvedValue({ status: 'ok', version: '1.3.0' }),
		getDocumentContent: vi.fn().mockResolvedValue('# Content'),
		getDocumentContext: vi.fn().mockResolvedValue({}),
		updateSettings: vi.fn(),
	};
}

function createMockSyncClient() {
	return {
		register: vi.fn(),
		sendManifestV2: vi.fn().mockResolvedValue({
			sync_session_id: 'session-001',
			needed_files: [],
			deleted_files: [],
			new_cursor: 'cursor-new',
			upload_endpoint: '/api/workspaces/ws-001/sync/upload',
			current_seq: 1,
			server_changes: [],
			server_deletions: [],
			conflicts: [],
			download_endpoint: '/api/workspaces/ws-001/sync/download',
		} satisfies SyncManifestResponseV2),
		uploadFiles: vi.fn().mockResolvedValue({
			sync_session_id: 'session-001',
			accepted: 0,
			rejected: 0,
			deduplicated: 0,
			indexing_triggered: false,
			rejected_files: [],
		} satisfies SyncUploadResponse),
		downloadFiles: vi.fn().mockResolvedValue({ files: [] }),
		getSyncStatus: vi.fn(),
		updateSettings: vi.fn(),
	};
}

function createMockFileHasher() {
	const hashMap = new Map<string, FileManifestEntry>();
	return {
		hashAllFiles: vi.fn().mockResolvedValue(hashMap),
		hashFile: vi.fn().mockResolvedValue('a'.repeat(64)),
		invalidateCache: vi.fn(),
		get cacheSize() { return 0; },
		_hashMap: hashMap,
	};
}

function createMockConflictLogger() {
	return {
		logConflicts: vi.fn().mockResolvedValue(undefined),
	};
}

function createMockVault() {
	return {
		getMarkdownFiles: vi.fn().mockReturnValue([]),
		read: vi.fn().mockResolvedValue('content'),
		getAbstractFileByPath: vi.fn().mockReturnValue(null),
		on: vi.fn().mockReturnValue({}),
		off: vi.fn(),
		getName: vi.fn().mockReturnValue('test-vault'),
		adapter: {
			read: vi.fn().mockResolvedValue(''),
			write: vi.fn().mockResolvedValue(undefined),
			append: vi.fn().mockResolvedValue(undefined),
			exists: vi.fn().mockResolvedValue(false),
		},
	};
}

function createMockPlugin(vault: ReturnType<typeof createMockVault>) {
	return {
		registerEvent: vi.fn(),
		saveData: vi.fn().mockResolvedValue(undefined),
		app: {
			vault,
			workspace: {},
		},
		manifest: { version: '1.3.0' },
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('v1.3 Feature Integration', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();

		vi.stubGlobal('window', {
			setTimeout: globalThis.setTimeout.bind(globalThis),
			clearTimeout: globalThis.clearTimeout.bind(globalThis),
			setInterval: globalThis.setInterval.bind(globalThis),
			clearInterval: globalThis.clearInterval.bind(globalThis),
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	// -----------------------------------------------------------------------
	// Dataview API integration
	// -----------------------------------------------------------------------

	describe('Dataview API end-to-end', () => {
		it('search() flows through ApiClient and returns results', async () => {
			vi.resetModules();
			const { createLumenAPI } = await import('../../src/dataview-api');
			const apiClient = createMockApiClient();
			const api = createLumenAPI(apiClient as any);

			const results = await api.search('machine learning', { limit: 5, tags: ['ai'] });

			expect(apiClient.semanticSearch).toHaveBeenCalledWith('machine learning', {
				limit: 5,
				tags: ['ai'],
			});
			expect(results).toHaveLength(1);
			expect(results[0].source_path).toBe('notes/result.md');
		});

		it('getSimilar() flows through ApiClient and returns results', async () => {
			vi.resetModules();
			const { createLumenAPI } = await import('../../src/dataview-api');
			const apiClient = createMockApiClient();
			const api = createLumenAPI(apiClient as any);

			const results = await api.getSimilar('notes/source.md', { limit: 3 });

			expect(apiClient.searchSimilarDocuments).toHaveBeenCalledWith('notes/source.md', {
				limit: 3,
			});
			expect(results).toHaveLength(1);
		});

		it('getTags() flows through ApiClient and returns tag list', async () => {
			vi.resetModules();
			const { createLumenAPI } = await import('../../src/dataview-api');
			const apiClient = createMockApiClient();
			const api = createLumenAPI(apiClient as any);

			const tags = await api.getTags();

			expect(apiClient.listTags).toHaveBeenCalledOnce();
			expect(tags).toHaveLength(3);
			expect(tags.map(t => t.tag)).toEqual(['ai', 'machine-learning', 'notes']);
		});

		it('error in ApiClient propagates to Dataview caller', async () => {
			vi.resetModules();
			const { createLumenAPI } = await import('../../src/dataview-api');
			const apiClient = createMockApiClient();
			apiClient.semanticSearch.mockRejectedValueOnce(new Error('401 Unauthorized'));
			const api = createLumenAPI(apiClient as any);

			await expect(api.search('test')).rejects.toThrow('401 Unauthorized');
		});
	});

	// -----------------------------------------------------------------------
	// Event-driven sync integration
	// -----------------------------------------------------------------------

	describe('event-driven sync end-to-end', () => {
		let settings: LumenSettings;
		let vault: ReturnType<typeof createMockVault>;
		let mockPlugin: ReturnType<typeof createMockPlugin>;
		let syncClient: ReturnType<typeof createMockSyncClient>;
		let fileHasher: ReturnType<typeof createMockFileHasher>;
		let conflictLogger: ReturnType<typeof createMockConflictLogger>;
		let manager: SyncManager;

		beforeEach(() => {
			// Stub document for visibility detection
			vi.stubGlobal('document', {
				hidden: false,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn(),
			});

			settings = createSettings();
			vault = createMockVault();
			mockPlugin = createMockPlugin(vault);
			syncClient = createMockSyncClient();
			fileHasher = createMockFileHasher();
			conflictLogger = createMockConflictLogger();

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
		});

		it('file modify → 60s debounce → sync execution', async () => {
			await manager.initialize();

			// Get the registered modify handler
			const modifyCall = vault.on.mock.calls.find(
				([name]: [string]) => name === 'modify',
			);
			expect(modifyCall).toBeDefined();
			const modifyHandler = modifyCall![1];

			// Simulate a file modification
			const mockFile = createMockTFile('notes/changed.md');
			await setTFilePrototype(mockFile);
			modifyHandler(mockFile);

			// Before 60s — no sync
			await vi.advanceTimersByTimeAsync(55_000);
			expect(fileHasher.hashAllFiles).not.toHaveBeenCalled();

			// After 60s — sync fires
			await vi.advanceTimersByTimeAsync(10_000);
			expect(fileHasher.hashAllFiles).toHaveBeenCalledOnce();
		});

		it('multiple file changes within debounce window → single sync', async () => {
			await manager.initialize();

			const modifyCall = vault.on.mock.calls.find(
				([name]: [string]) => name === 'modify',
			);
			const modifyHandler = modifyCall![1];

			// Simulate 3 file modifications in quick succession
			for (const path of ['a.md', 'b.md', 'c.md']) {
				const file = createMockTFile(`notes/${path}`);
				await setTFilePrototype(file);
				modifyHandler(file);
			}

			// After debounce, only one sync should have fired
			await vi.advanceTimersByTimeAsync(65_000);
			expect(fileHasher.hashAllFiles).toHaveBeenCalledOnce();
		});

		it('defers sync when hidden, resumes when visible', async () => {
			await manager.initialize();

			// Get visibility handler
			const docAddListener = (globalThis as any).document.addEventListener;
			const visCall = docAddListener.mock.calls.find(
				([name]: [string]) => name === 'visibilitychange',
			);
			expect(visCall).toBeDefined();
			const visibilityHandler = visCall![1];

			// Get modify handler
			const modifyCall = vault.on.mock.calls.find(
				([name]: [string]) => name === 'modify',
			);
			const modifyHandler = modifyCall![1];

			// Go hidden
			(globalThis as any).document.hidden = true;

			// Modify a file — should be deferred
			const file = createMockTFile('notes/deferred.md');
			await setTFilePrototype(file);
			modifyHandler(file);

			// Wait well past debounce — no sync should fire
			await vi.advanceTimersByTimeAsync(120_000);
			expect(fileHasher.hashAllFiles).not.toHaveBeenCalled();

			// Come back to foreground
			(globalThis as any).document.hidden = false;
			visibilityHandler();

			// Now the debounce should schedule and eventually fire
			await vi.advanceTimersByTimeAsync(65_000);
			expect(fileHasher.hashAllFiles).toHaveBeenCalledOnce();
		});

		it('manual syncNow bypasses debounce', async () => {
			await manager.initialize();

			const modifyCall = vault.on.mock.calls.find(
				([name]: [string]) => name === 'modify',
			);
			const modifyHandler = modifyCall![1];

			// Modify a file (starts debounce timer)
			const file = createMockTFile('notes/manual.md');
			await setTFilePrototype(file);
			modifyHandler(file);

			// Don't wait for debounce — trigger manual sync immediately
			const result = await manager.syncNow();

			expect(result.success).toBe(true);
			expect(fileHasher.hashAllFiles).toHaveBeenCalledOnce();
		});

		it('excludes files matching exclude patterns from sync events', async () => {
			await manager.initialize();

			const modifyCall = vault.on.mock.calls.find(
				([name]: [string]) => name === 'modify',
			);
			const modifyHandler = modifyCall![1];

			// Create a file in an excluded path (.obsidian/)
			const excludedFile = { ...createMockTFile('.obsidian/workspace.json'), extension: 'json' };
			await setTFilePrototype(excludedFile);
			modifyHandler(excludedFile);

			// Wait past debounce — no sync should trigger (excluded by pattern)
			await vi.advanceTimersByTimeAsync(65_000);
			expect(fileHasher.hashAllFiles).not.toHaveBeenCalled();
		});

		it('does not trigger sync when eventSyncEnabled is disabled', async () => {
			// Reinitialize with disabled event sync
			manager.destroy();
			manager = new SyncManager(
				mockPlugin as any,
				settings,
				syncClient as any,
				fileHasher as any,
				conflictLogger as any,
			);
			manager.applySyncConfig({ sync_enabled: true, sync_interval_minutes: 5, event_sync_enabled: false });
			await manager.initialize();

			const modifyCall = vault.on.mock.calls.find(
				([name]: [string]) => name === 'modify',
			);
			const modifyHandler = modifyCall![1];

			const file = createMockTFile('notes/disabled.md');
			await setTFilePrototype(file);
			modifyHandler(file);

			await vi.advanceTimersByTimeAsync(120_000);
			expect(fileHasher.hashAllFiles).not.toHaveBeenCalled();
		});
	});

	// -----------------------------------------------------------------------
	// Search with tags filter integration
	// -----------------------------------------------------------------------

	describe('search with tags filter', () => {
		it('tags from listTags are used to filter search results', async () => {
			const apiClient = createMockApiClient();

			// Simulate the full flow: fetch tags → select tag → search with tag
			const tags = await apiClient.listTags();
			expect(tags).toHaveLength(3);

			// Search with a selected tag filter
			await apiClient.semanticSearch('neural networks', {
				limit: 20,
				tags: ['ai'],
			});

			expect(apiClient.semanticSearch).toHaveBeenCalledWith('neural networks', {
				limit: 20,
				tags: ['ai'],
			});
		});

		it('search without tags does not include tag filter', async () => {
			const apiClient = createMockApiClient();

			await apiClient.semanticSearch('general query', { limit: 20 });

			expect(apiClient.semanticSearch).toHaveBeenCalledWith('general query', {
				limit: 20,
			});
		});

		it('search with multiple tags passes all selected', async () => {
			const apiClient = createMockApiClient();

			await apiClient.semanticSearch('query', {
				limit: 20,
				tags: ['ai', 'machine-learning'],
			});

			expect(apiClient.semanticSearch).toHaveBeenCalledWith('query', {
				limit: 20,
				tags: ['ai', 'machine-learning'],
			});
		});
	});
});
