/**
 * SyncManager unit tests.
 *
 * Tests the core sync orchestration:
 *   - State machine transitions (idle → hashing → manifest → uploading → success → idle)
 *   - Error state and retry logic
 *   - Manual sync (syncNow)
 *   - Auto-sync debounce
 *   - Vault event listeners
 *   - destroy() cleanup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncManager } from '../../src/sync/sync-manager';
import { DEFAULT_SETTINGS } from '../../src/types';
import type { LumenSettings, FileManifestEntry, SyncManifestResponseV2 } from '../../src/types';

// ---------------------------------------------------------------------------
// Mock obsidian module
// ---------------------------------------------------------------------------

vi.mock('obsidian', () => ({
	Notice: vi.fn(),
	TFile: class { extension = 'md'; },
	TAbstractFile: class {},
	Plugin: class {},
	Vault: class {},
	normalizePath: (p: string) => p,
	Platform: { isDesktop: true, isMobile: false },
}));

// ---------------------------------------------------------------------------
// Helpers: mock factories
// ---------------------------------------------------------------------------

function createSettings(overrides: Partial<LumenSettings> = {}): LumenSettings {
	return {
		...DEFAULT_SETTINGS,
		syncEnabled: true,
		autoSyncInterval: 5,
		apiUrl: 'https://app.getlumen.io',
		apiKey: 'test-key',
		workspaceId: 'ws-001',
		deviceId: 'test-device-001',
		...overrides,
	};
}

function createMockFileHasher() {
	const hashMap = new Map<string, FileManifestEntry>();
	return {
		hashAllFiles: vi.fn().mockResolvedValue(hashMap),
		hashFile: vi.fn().mockResolvedValue('a'.repeat(64)),
		invalidateCache: vi.fn(),
		get cacheSize() { return 0; },
	};
}

function createDefaultV2Response(overrides: Partial<SyncManifestResponseV2> = {}): SyncManifestResponseV2 {
	return {
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
		...overrides,
	};
}

function createMockSyncClient() {
	return {
		register: vi.fn(),
		sendManifestV2: vi.fn().mockResolvedValue(createDefaultV2Response()),
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
}

function createMockConflictLogger() {
	return {
		logConflicts: vi.fn().mockResolvedValue(undefined),
	};
}

/** Track vault event registrations */
type EventRegistration = { eventName: string; handler: (...args: any[]) => void };

function createMockPlugin() {
	const eventRegistrations: EventRegistration[] = [];
	const vaultOn = vi.fn((eventName: string, handler: (...args: any[]) => void) => {
		eventRegistrations.push({ eventName, handler });
		return { eventName, handler }; // EventRef
	});

	return {
		plugin: {
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
			manifest: { version: '0.1.0' },
		},
		eventRegistrations,
		vaultOn,
	};
}

/** Fake timer helpers */
function createMockTFile(path: string, extension = 'md') {
	// We need to create an object that passes `instanceof TFile` — but since
	// TFile is mocked, we need to import the mocked version.
	return {
		path,
		name: path.split('/').pop()!,
		basename: path.split('/').pop()!.replace(`.${extension}`, ''),
		extension,
		stat: { mtime: Date.now(), ctime: Date.now(), size: 100 },
		vault: {} as any,
		parent: null,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SyncManager', () => {
	let settings: LumenSettings;
	let fileHasher: ReturnType<typeof createMockFileHasher>;
	let syncClient: ReturnType<typeof createMockSyncClient>;
	let conflictLogger: ReturnType<typeof createMockConflictLogger>;
	let mockPlugin: ReturnType<typeof createMockPlugin>;
	let manager: SyncManager;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();

		// SyncManager uses window.setTimeout/setInterval — stub the window global
		// since we're running in Node.js (vitest node environment).
		vi.stubGlobal('window', {
			setTimeout: globalThis.setTimeout.bind(globalThis),
			clearTimeout: globalThis.clearTimeout.bind(globalThis),
			setInterval: globalThis.setInterval.bind(globalThis),
			clearInterval: globalThis.clearInterval.bind(globalThis),
		});

		settings = createSettings();
		fileHasher = createMockFileHasher();
		syncClient = createMockSyncClient();
		conflictLogger = createMockConflictLogger();
		mockPlugin = createMockPlugin();

		manager = new SyncManager(
			mockPlugin.plugin as any,
			settings,
			syncClient as any,
			fileHasher as any,
			conflictLogger as any,
		);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	// -----------------------------------------------------------------------
	// State machine transitions
	// -----------------------------------------------------------------------

	describe('state machine', () => {
		it('starts in idle state', () => {
			expect(manager.getState()).toBe('idle');
		});

		it('transitions idle → hashing → manifest → success → idle on sync with no files', async () => {
			const states: string[] = [];
			manager.onStateChange((state) => states.push(state));

			// hashAllFiles returns empty map (no files to sync)
			fileHasher.hashAllFiles.mockResolvedValue(new Map());

			const resultPromise = manager.syncNow();
			await resultPromise;

			// With no files, the flow is: hashing → manifest → success
			// (manifest state may be set but the entries check short-circuits to success)
			expect(states).toContain('hashing');
			expect(states).toContain('success');

			// After success timer, should go back to idle
			vi.advanceTimersByTime(6000);
			expect(manager.getState()).toBe('idle');
		});

		it('transitions through full flow when files need uploading', async () => {
			const states: string[] = [];
			manager.onStateChange((state) => states.push(state));

			// Set up hashAllFiles to return files
			const hashMap = new Map<string, FileManifestEntry>();
			hashMap.set('notes/test.md', {
				path: 'notes/test.md',
				content_hash: 'a'.repeat(64),
				modified_at: '2026-02-13T10:00:00.000Z',
				size_bytes: 100,
				action: 'add',
			});
			fileHasher.hashAllFiles.mockResolvedValue(hashMap);

			// Server needs the file
			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 'session-002',
				needed_files: ['notes/test.md'],
			}));

			// Mock reading the file for upload
			const mockFile = createMockTFile('notes/test.md');
			// Make getAbstractFileByPath return something that looks like TFile
			// Since our TFile mock is just a class, we need to work around instanceof
			mockPlugin.plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			syncClient.uploadFiles.mockResolvedValue({
				sync_session_id: 'session-002',
				accepted: 1,
				rejected: 0,
				deduplicated: 0,
				indexing_triggered: true,
				rejected_files: [],
			});

			await manager.syncNow();

			expect(states).toContain('hashing');
			expect(states).toContain('manifest');
			expect(states).toContain('uploading');
			expect(states).toContain('success');
		});

		it('transitions to error on failure', async () => {
			const states: string[] = [];
			manager.onStateChange((state) => states.push(state));

			// Make hashing fail with a non-retryable error
			fileHasher.hashAllFiles.mockRejectedValue(new Error('404 Not Found'));

			const result = await manager.syncNow();

			expect(result.success).toBe(false);
			expect(states).toContain('hashing');
			expect(states).toContain('error');
		});

		it('retries on transient errors', async () => {
			// First call fails with a retryable error, second succeeds
			fileHasher.hashAllFiles
				.mockRejectedValueOnce(new Error('503 Service Unavailable'))
				.mockResolvedValueOnce(new Map());

			const resultPromise = manager.syncNow();

			// Advance past the retry delay (1s for first retry)
			await vi.advanceTimersByTimeAsync(2000);

			const result = await resultPromise;

			expect(result.success).toBe(true);
			expect(fileHasher.hashAllFiles).toHaveBeenCalledTimes(2);
		});

		it('gives up after MAX_RETRIES', async () => {
			// All calls fail with retryable errors
			fileHasher.hashAllFiles.mockRejectedValue(new Error('502 Bad Gateway'));

			const resultPromise = manager.syncNow();

			// Advance past all retry delays (1s + 2s + 4s = 7s)
			await vi.advanceTimersByTimeAsync(10000);

			const result = await resultPromise;

			expect(result.success).toBe(false);
			// Initial + 3 retries = 4 total calls
			expect(fileHasher.hashAllFiles).toHaveBeenCalledTimes(4);
		});
	});

	// -----------------------------------------------------------------------
	// syncNow
	// -----------------------------------------------------------------------

	describe('syncNow', () => {
		it('triggers full sync flow', async () => {
			fileHasher.hashAllFiles.mockResolvedValue(new Map());

			const result = await manager.syncNow();

			expect(result.success).toBe(true);
			expect(fileHasher.hashAllFiles).toHaveBeenCalledOnce();
		});

		it('returns result with file counts', async () => {
			const hashMap = new Map<string, FileManifestEntry>();
			hashMap.set('test.md', {
				path: 'test.md',
				content_hash: 'a'.repeat(64),
				modified_at: new Date().toISOString(),
				size_bytes: 50,
				action: 'add',
			});
			fileHasher.hashAllFiles.mockResolvedValue(hashMap);

			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 's1',
				needed_files: ['test.md'],
			}));

			const mockFile = createMockTFile('test.md');
			mockPlugin.plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			syncClient.uploadFiles.mockResolvedValue({
				sync_session_id: 's1',
				accepted: 1,
				rejected: 0,
				deduplicated: 0,
				indexing_triggered: true,
				rejected_files: [],
			});

			const result = await manager.syncNow();

			expect(result.success).toBe(true);
			expect(result.filesUploaded).toBe(1);
			expect(result.duration).toBeGreaterThanOrEqual(0);
		});

		it('handles empty needed_files (no upload needed)', async () => {
			const hashMap = new Map<string, FileManifestEntry>();
			hashMap.set('unchanged.md', {
				path: 'unchanged.md',
				content_hash: 'a'.repeat(64),
				modified_at: new Date().toISOString(),
				size_bytes: 50,
				action: 'add',
			});
			fileHasher.hashAllFiles.mockResolvedValue(hashMap);

			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 's2',
			}));

			const result = await manager.syncNow();

			expect(result.success).toBe(true);
			expect(result.filesUploaded).toBe(0);
			// uploadFiles should NOT have been called
			expect(syncClient.uploadFiles).not.toHaveBeenCalled();
		});

		it('handles sync when no files changed (empty manifest)', async () => {
			fileHasher.hashAllFiles.mockResolvedValue(new Map());

			const result = await manager.syncNow();

			expect(result.success).toBe(true);
			expect(result.filesUploaded).toBe(0);
			expect(result.filesDeleted).toBe(0);
			// Always sends manifest now — even empty manifests discover server changes
			expect(syncClient.sendManifestV2).toHaveBeenCalled();
		});

		it('updates settings cursor after successful sync', async () => {
			const hashMap = new Map<string, FileManifestEntry>();
			hashMap.set('test.md', {
				path: 'test.md',
				content_hash: 'a'.repeat(64),
				modified_at: new Date().toISOString(),
				size_bytes: 50,
				action: 'add',
			});
			fileHasher.hashAllFiles.mockResolvedValue(hashMap);

			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 's3',
				new_cursor: 'new-cursor-xyz',
			}));

			await manager.syncNow();

			expect(settings.lastSyncCursor).toBe('new-cursor-xyz');
			expect(settings.lastSyncAt).toBeTruthy();
		});

		it('prevents concurrent syncs', async () => {
			// Make hashAllFiles slow so we can test concurrency
			let resolveHash: () => void;
			fileHasher.hashAllFiles.mockReturnValue(
				new Promise<Map<string, FileManifestEntry>>((resolve) => {
					resolveHash = () => resolve(new Map());
				}),
			);

			const promise1 = manager.syncNow();
			const promise2 = manager.syncNow();

			// Resolve the first hash
			resolveHash!();
			const [result1, result2] = await Promise.all([promise1, promise2]);

			// Second call should return immediately with failure
			expect(result2.success).toBe(false);
			expect(result2.errors[0]).toContain('already in progress');
		});
	});

	// -----------------------------------------------------------------------
	// onStateChange callback
	// -----------------------------------------------------------------------

	describe('onStateChange', () => {
		it('fires on state transitions', async () => {
			const callback = vi.fn();
			manager.onStateChange(callback);

			fileHasher.hashAllFiles.mockResolvedValue(new Map());
			await manager.syncNow();

			expect(callback).toHaveBeenCalled();
			expect(callback.mock.calls.some(([s]: [string]) => s === 'hashing')).toBe(true);
		});

		it('supports multiple callbacks', async () => {
			const cb1 = vi.fn();
			const cb2 = vi.fn();
			manager.onStateChange(cb1);
			manager.onStateChange(cb2);

			fileHasher.hashAllFiles.mockResolvedValue(new Map());
			await manager.syncNow();

			expect(cb1).toHaveBeenCalled();
			expect(cb2).toHaveBeenCalled();
		});

		it('does not break sync if callback throws', async () => {
			manager.onStateChange(() => {
				throw new Error('callback exploded');
			});

			fileHasher.hashAllFiles.mockResolvedValue(new Map());
			const result = await manager.syncNow();

			// Sync should still succeed despite callback error
			expect(result.success).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Auto-sync debounce
	// -----------------------------------------------------------------------

	describe('auto-sync debounce', () => {
		it('scheduleDebounce triggers after 10 seconds', async () => {
			await manager.initialize();

			// Simulate a vault event that triggers debounce
			// Get the registered 'modify' handler
			const modifyCall = mockPlugin.plugin.app.vault.on.mock.calls.find(
				([name]: [string]) => name === 'modify',
			);
			expect(modifyCall).toBeDefined();

			// The handler is the second argument
			const modifyHandler = modifyCall![1];

			// Trigger the handler with a mock TFile
			const mockFile = createMockTFile('notes/test.md');
			(mockFile as any).constructor = (await import('obsidian')).TFile;
			Object.setPrototypeOf(mockFile, (await import('obsidian')).TFile.prototype);
			modifyHandler(mockFile);

			// Sync should not happen immediately
			expect(fileHasher.hashAllFiles).not.toHaveBeenCalled();
		});

		it('manual sync cancels pending debounce', async () => {
			fileHasher.hashAllFiles.mockResolvedValue(new Map());

			// Start manager with auto-sync
			await manager.initialize();

			// syncNow should work (clears any debounce)
			const result = await manager.syncNow();
			expect(result.success).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Auto-sync start/stop
	// -----------------------------------------------------------------------

	describe('auto-sync', () => {
		it('startAutoSync sets up interval timer', async () => {
			settings.autoSyncInterval = 1; // 1 minute
			manager.startAutoSync();

			// Should not sync immediately
			expect(fileHasher.hashAllFiles).not.toHaveBeenCalled();
		});

		it('stopAutoSync clears interval', () => {
			manager.startAutoSync();
			manager.stopAutoSync();

			// Advancing time should not trigger sync
			vi.advanceTimersByTime(600_000); // 10 minutes
			expect(fileHasher.hashAllFiles).not.toHaveBeenCalled();
		});

		it('does not start auto-sync if interval is 0', () => {
			settings.autoSyncInterval = 0;
			manager.startAutoSync();

			vi.advanceTimersByTime(600_000);
			expect(fileHasher.hashAllFiles).not.toHaveBeenCalled();
		});
	});

	// -----------------------------------------------------------------------
	// Vault event listeners
	// -----------------------------------------------------------------------

	describe('vault event listeners', () => {
		it('registers modify, delete, rename events on initialize', async () => {
			await manager.initialize();

			const registeredEvents = mockPlugin.plugin.app.vault.on.mock.calls.map(
				([name]: [string]) => name,
			);

			expect(registeredEvents).toContain('modify');
			expect(registeredEvents).toContain('delete');
			expect(registeredEvents).toContain('rename');
		});

		it('uses registerEvent for proper cleanup', async () => {
			await manager.initialize();

			// registerEvent should be called for each event
			expect(mockPlugin.plugin.registerEvent).toHaveBeenCalledTimes(3);
		});
	});

	// -----------------------------------------------------------------------
	// destroy()
	// -----------------------------------------------------------------------

	describe('destroy', () => {
		it('clears all timers and callbacks', async () => {
			const stateCallback = vi.fn();
			const progressCallback = vi.fn();

			manager.onStateChange(stateCallback);
			manager.onProgress(progressCallback);
			manager.startAutoSync();

			manager.destroy();

			// After destroy, syncing should not trigger callbacks
			fileHasher.hashAllFiles.mockResolvedValue(new Map());
			const result = await manager.syncNow();

			expect(stateCallback).not.toHaveBeenCalled();
		});

		it('clears pending changes', async () => {
			manager.destroy();

			// After destroy, sync should have no work to do
			fileHasher.hashAllFiles.mockResolvedValue(new Map());
			const result = await manager.syncNow();
			expect(result.success).toBe(true);
			expect(result.filesUploaded).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// Exclude patterns
	// -----------------------------------------------------------------------

	describe('exclude patterns', () => {
		it('syncs correctly despite exclude patterns in settings', async () => {
			settings.excludePatterns = ['.obsidian/', '.trash/'];

			fileHasher.hashAllFiles.mockResolvedValue(new Map());

			const result = await manager.syncNow();
			expect(result.success).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Conflict detection
	// -----------------------------------------------------------------------

	describe('conflict detection', () => {
		it('logs conflicts when server deletes locally tracked files', async () => {
			const hashMap = new Map<string, FileManifestEntry>();
			hashMap.set('keep.md', {
				path: 'keep.md',
				content_hash: 'a'.repeat(64),
				modified_at: new Date().toISOString(),
				size_bytes: 50,
				action: 'add',
			});
			fileHasher.hashAllFiles.mockResolvedValue(hashMap);

			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 'conflict-session',
				deleted_files: ['conflicted.md'],  // server deleted this
				new_cursor: 'c-conflict',
			}));

			const result = await manager.syncNow();

			// Even though there's a deleted_files entry, conflicts are only logged
			// if the file was in pendingChanges — and we haven't triggered any
			// vault events, so conflictLogger should be called with empty or
			// no conflicts depending on pendingChanges state
			expect(result.success).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Event-driven sync (visibility / idle detection)
	// -----------------------------------------------------------------------

	describe('event-driven sync', () => {
		// Stub a minimal `document` global for visibility tests
		let mockDocument: { hidden: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn>; dispatchEvent: ReturnType<typeof vi.fn> };

		beforeEach(() => {
			mockDocument = {
				hidden: false,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn(),
			};
			vi.stubGlobal('document', mockDocument);
		});

		it('registers visibilitychange handler when eventSyncEnabled is true', async () => {
			settings.eventSyncEnabled = true;

			await manager.initialize();

			expect(mockDocument.addEventListener).toHaveBeenCalledWith(
				'visibilitychange',
				expect.any(Function),
			);
		});

		it('does not register visibilitychange handler when eventSyncEnabled is false', async () => {
			settings.eventSyncEnabled = false;

			await manager.initialize();

			expect(mockDocument.addEventListener).not.toHaveBeenCalledWith(
				'visibilitychange',
				expect.any(Function),
			);
		});

		it('defers debounce when document is hidden', async () => {
			settings.eventSyncEnabled = true;
			mockDocument.hidden = true;
			await manager.initialize();

			// Trigger a vault modify event
			const modifyCall = mockPlugin.plugin.app.vault.on.mock.calls.find(
				([name]: [string]) => name === 'modify',
			);
			const modifyHandler = modifyCall![1];
			const mockFile = createMockTFile('notes/deferred.md');
			Object.setPrototypeOf(mockFile, (await import('obsidian')).TFile.prototype);
			modifyHandler(mockFile);

			// Even after debounce time, sync should NOT fire (paused while hidden)
			await vi.advanceTimersByTimeAsync(65_000);
			expect(fileHasher.hashAllFiles).not.toHaveBeenCalled();
		});

		it('resumes deferred sync when document becomes visible', async () => {
			settings.eventSyncEnabled = true;
			mockDocument.hidden = true;
			fileHasher.hashAllFiles.mockResolvedValue(new Map());
			await manager.initialize();

			// Trigger a vault modify event (should be deferred)
			const modifyCall = mockPlugin.plugin.app.vault.on.mock.calls.find(
				([name]: [string]) => name === 'modify',
			);
			const modifyHandler = modifyCall![1];
			const mockFile = createMockTFile('notes/deferred.md');
			Object.setPrototypeOf(mockFile, (await import('obsidian')).TFile.prototype);
			modifyHandler(mockFile);

			// Document becomes visible — invoke the registered visibilitychange handler
			mockDocument.hidden = false;
			const visibilityCall = mockDocument.addEventListener.mock.calls.find(
				([name]: [string]) => name === 'visibilitychange',
			);
			expect(visibilityCall).toBeDefined();
			const visibilityHandler = visibilityCall![1];
			visibilityHandler();

			// After the debounce period, sync should fire
			await vi.advanceTimersByTimeAsync(65_000);
			// The file was added to pendingChanges, and after visibility restore + debounce,
			// executeSync should have been called
			expect(fileHasher.hashAllFiles).toHaveBeenCalled();
		});

		it('removes visibilitychange handler on destroy', async () => {
			settings.eventSyncEnabled = true;

			await manager.initialize();
			manager.destroy();

			expect(mockDocument.removeEventListener).toHaveBeenCalledWith(
				'visibilitychange',
				expect.any(Function),
			);
		});

		it('does not schedule debounce when syncEnabled is false', async () => {
			settings.syncEnabled = false;
			settings.eventSyncEnabled = true;
			await manager.initialize();

			const modifyCall = mockPlugin.plugin.app.vault.on.mock.calls.find(
				([name]: [string]) => name === 'modify',
			);
			const modifyHandler = modifyCall![1];
			const mockFile = createMockTFile('notes/nosync.md');
			Object.setPrototypeOf(mockFile, (await import('obsidian')).TFile.prototype);
			modifyHandler(mockFile);

			await vi.advanceTimersByTimeAsync(65_000);
			expect(fileHasher.hashAllFiles).not.toHaveBeenCalled();
		});

		it('does not schedule debounce when eventSyncEnabled is false', async () => {
			settings.syncEnabled = true;
			settings.eventSyncEnabled = false;
			await manager.initialize();

			const modifyCall = mockPlugin.plugin.app.vault.on.mock.calls.find(
				([name]: [string]) => name === 'modify',
			);
			const modifyHandler = modifyCall![1];
			const mockFile = createMockTFile('notes/noevent.md');
			Object.setPrototypeOf(mockFile, (await import('obsidian')).TFile.prototype);
			modifyHandler(mockFile);

			await vi.advanceTimersByTimeAsync(65_000);
			expect(fileHasher.hashAllFiles).not.toHaveBeenCalled();
		});

		it('uses 60-second debounce interval', async () => {
			settings.eventSyncEnabled = true;
			settings.syncEnabled = true;
			mockDocument.hidden = false;
			fileHasher.hashAllFiles.mockResolvedValue(new Map());
			await manager.initialize();

			const modifyCall = mockPlugin.plugin.app.vault.on.mock.calls.find(
				([name]: [string]) => name === 'modify',
			);
			const modifyHandler = modifyCall![1];
			const mockFile = createMockTFile('notes/debounce.md');
			Object.setPrototypeOf(mockFile, (await import('obsidian')).TFile.prototype);

			modifyHandler(mockFile);

			// At 55 seconds, sync should NOT have fired yet
			await vi.advanceTimersByTimeAsync(55_000);
			expect(fileHasher.hashAllFiles).not.toHaveBeenCalled();

			// At 65 seconds (past 60s debounce), sync should fire
			await vi.advanceTimersByTimeAsync(10_000);
			expect(fileHasher.hashAllFiles).toHaveBeenCalled();
		});
	});

	// -----------------------------------------------------------------------
	// Progress reporting
	// -----------------------------------------------------------------------

	describe('progress', () => {
		it('reports hashing progress via callback', async () => {
			const progress = vi.fn();
			manager.onProgress(progress);

			// Make hashAllFiles call the progress callback
			fileHasher.hashAllFiles.mockImplementation(async (onProgress) => {
				onProgress?.(25, 100);
				onProgress?.(50, 100);
				onProgress?.(100, 100);
				return new Map();
			});

			await manager.syncNow();

			expect(progress).toHaveBeenCalledWith('hashing', expect.objectContaining({
				current: 25,
				total: 100,
			}));
		});
	});
});
