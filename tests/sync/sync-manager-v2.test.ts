/**
 * SyncManager V2 integration tests.
 *
 * Tests V2-specific sync paths through the public syncNow() API:
 *   - Full V2 flow: manifest → download → upload → conflict log
 *   - lastSyncSeq update after successful V2 sync
 *   - BUG-2: settings persistence after every sync (not just manual)
 *   - BUG-1: local content read BEFORE handleServerChanges overwrites
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncManager } from '../../src/sync/sync-manager';
import { FileHasher } from '../../src/sync/file-hasher';
import { DEFAULT_SETTINGS } from '../../src/types';
import type {
	LumenSettings,
	FileManifestEntry,
	SyncManifestResponseV2,
} from '../../src/types';

// ---------------------------------------------------------------------------
// Mock obsidian
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
// Helpers
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

function createMockFileHasher(hashMap?: Map<string, FileManifestEntry>) {
	return {
		hashAllFiles: vi.fn().mockResolvedValue(hashMap ?? new Map()),
		hashFile: vi.fn().mockResolvedValue('a'.repeat(64)),
		invalidateCache: vi.fn(),
		get cacheSize() { return 0; },
	};
}

function createV2Response(overrides: Partial<SyncManifestResponseV2> = {}): SyncManifestResponseV2 {
	return {
		sync_session_id: 'session-v2',
		needed_files: [],
		deleted_files: [],
		new_cursor: 'cursor-v2',
		upload_endpoint: '/api/workspaces/ws-001/sync/upload',
		current_seq: 10,
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
		sendManifestV2: vi.fn().mockResolvedValue(createV2Response()),
		uploadFiles: vi.fn().mockResolvedValue({
			sync_session_id: 'session-v2',
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

function createMockPlugin() {
	return {
		registerEvent: vi.fn(),
		saveData: vi.fn().mockResolvedValue(undefined),
		app: {
			vault: {
				on: vi.fn(() => ({ eventName: '', handler: () => {} })),
				off: vi.fn(),
				read: vi.fn().mockResolvedValue('local content'),
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
	};
}

function createMockTFile(path: string) {
	return {
		path,
		name: path.split('/').pop()!,
		basename: path.split('/').pop()!.replace('.md', ''),
		extension: 'md',
		stat: { mtime: Date.now(), ctime: Date.now(), size: 100 },
		vault: {} as any,
		parent: null,
	};
}

/** Make a mock file pass instanceof TFile checks */
async function asTFile(mock: ReturnType<typeof createMockTFile>) {
	const { TFile } = await import('obsidian');
	Object.setPrototypeOf(mock, TFile.prototype);
	return mock;
}

/** Helper to build a single-file hash map */
function singleFileHashMap(path = 'notes/test.md'): Map<string, FileManifestEntry> {
	const map = new Map<string, FileManifestEntry>();
	map.set(path, {
		path,
		content_hash: 'a'.repeat(64),
		modified_at: new Date().toISOString(),
		size_bytes: 100,
		action: 'add',
	});
	return map;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SyncManager V2 integration', () => {
	let settings: LumenSettings;
	let fileHasher: ReturnType<typeof createMockFileHasher>;
	let syncClient: ReturnType<typeof createMockSyncClient>;
	let conflictLogger: ReturnType<typeof createMockConflictLogger>;
	let plugin: ReturnType<typeof createMockPlugin>;
	let manager: SyncManager;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.stubGlobal('window', {
			setTimeout: globalThis.setTimeout.bind(globalThis),
			clearTimeout: globalThis.clearTimeout.bind(globalThis),
			setInterval: globalThis.setInterval.bind(globalThis),
			clearInterval: globalThis.clearInterval.bind(globalThis),
		});

		// Mock FileHasher static methods so hash verification passes with fake hashes
		vi.spyOn(FileHasher, 'computeSHA256').mockImplementation(async () => '__mock_hash__');
		vi.spyOn(FileHasher, 'computeSHA256Binary').mockImplementation(async () => '__mock_hash__');

		settings = createSettings();
		fileHasher = createMockFileHasher(singleFileHashMap());
		syncClient = createMockSyncClient();
		conflictLogger = createMockConflictLogger();
		plugin = createMockPlugin();

		manager = new SyncManager(
			plugin as any,
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
	// Full V2 flow
	// -----------------------------------------------------------------------

	describe('V2 full flow', () => {
		it('calls sendManifestV2 with deviceId and lastSyncSeq', async () => {
			settings.lastSyncSeq = 5;
			settings.lastSyncCursor = 'old-cursor';

			await manager.syncNow();

			expect(syncClient.sendManifestV2).toHaveBeenCalledWith(
				expect.any(Array),
				'test-device-001',
				5,
				'old-cursor',
				expect.any(AbortSignal),
				undefined,
			);
		});

		it('downloads server changes when V2 response includes them', async () => {
			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: [
					{ path: 'notes/from-server.md', content_hash: '__mock_hash__', size_bytes: 200, seq: 9 },
				],
			}));

			syncClient.downloadFiles.mockResolvedValue({
				files: [{
					path: 'notes/from-server.md',
					content_base64: btoa('# From Server'),
					content_hash: '__mock_hash__',
					size_bytes: 200,
				}],
			});

			const result = await manager.syncNow();

			expect(syncClient.downloadFiles).toHaveBeenCalledWith(
				'session-v2',
				['notes/from-server.md'],
				'/api/workspaces/ws-001/sync/download',
				expect.any(AbortSignal),
			);
			expect(result.filesDownloaded).toBe(1);
		});

		it('handles server deletions', async () => {
			const mockFile = createMockTFile('notes/deleted-on-server.md');
			await asTFile(mockFile);
			plugin.app.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'notes/deleted-on-server.md') return mockFile;
				return null;
			});

			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_deletions: ['notes/deleted-on-server.md'],
			}));

			const result = await manager.syncNow();

			expect(plugin.app.vault.delete).toHaveBeenCalledWith(mockFile);
			expect(result.filesDeleted).toBeGreaterThanOrEqual(1);
		});

		it('skips deletion when file not found locally', async () => {
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_deletions: ['notes/already-gone.md'],
			}));

			const result = await manager.syncNow();

			expect(plugin.app.vault.delete).not.toHaveBeenCalled();
			expect(result.success).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// lastSyncSeq update
	// -----------------------------------------------------------------------

	describe('lastSyncSeq', () => {
		it('updates lastSyncSeq to current_seq from V2 response', async () => {
			settings.lastSyncSeq = 5;

			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				current_seq: 42,
			}));

			await manager.syncNow();

			expect(settings.lastSyncSeq).toBe(42);
		});

		it('sends correct lastSyncSeq to server on subsequent syncs', async () => {
			settings.lastSyncSeq = 0;

			// First sync
			syncClient.sendManifestV2.mockResolvedValue(createV2Response({ current_seq: 10 }));
			await manager.syncNow();

			expect(settings.lastSyncSeq).toBe(10);

			// Second sync should pass the updated seq
			syncClient.sendManifestV2.mockResolvedValue(createV2Response({ current_seq: 20 }));
			await manager.syncNow();

			const secondCall = syncClient.sendManifestV2.mock.calls[1]!;
			expect(secondCall[2]).toBe(10); // lastSyncSeq argument
			expect(settings.lastSyncSeq).toBe(20);
		});
	});

	// -----------------------------------------------------------------------
	// BUG-2: Settings persistence
	// -----------------------------------------------------------------------

	describe('BUG-2: settings persistence', () => {
		it('calls plugin.saveData after every successful sync', async () => {
			await manager.syncNow();

			expect(plugin.saveData).toHaveBeenCalledWith(settings);
		});

		it('persists updated cursor and seq in settings', async () => {
			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				new_cursor: 'persisted-cursor',
				current_seq: 99,
			}));

			await manager.syncNow();

			// Verify the settings object passed to saveData has the updated values
			const savedSettings = plugin.saveData.mock.calls[0]![0] as LumenSettings;
			expect(savedSettings.lastSyncCursor).toBe('persisted-cursor');
			expect(savedSettings.lastSyncSeq).toBe(99);
			expect(savedSettings.lastSyncAt).toBeTruthy();
		});

		it('does not call saveData on sync failure', async () => {
			fileHasher.hashAllFiles.mockRejectedValue(new Error('404 Not Found'));

			await manager.syncNow();

			expect(plugin.saveData).not.toHaveBeenCalled();
		});
	});

	// -----------------------------------------------------------------------
	// BUG-1: Conflict ordering — read local BEFORE server overwrites
	// -----------------------------------------------------------------------

	describe('BUG-1: conflict content ordering', () => {
		it('reads local content before downloading server changes', async () => {
			const callOrder: string[] = [];

			// Track when vault.read is called (for pre-reading conflict content)
			const mockConflictFile = createMockTFile('notes/conflict.md');
			await asTFile(mockConflictFile);
			plugin.app.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'notes/conflict.md') return mockConflictFile;
				return null;
			});
			plugin.app.vault.read.mockImplementation(async () => {
				callOrder.push('read-local');
				return 'local content before overwrite';
			});

			// Track when downloadFiles is called
			syncClient.downloadFiles.mockImplementation(async () => {
				callOrder.push('download');
				return {
					files: [{
						path: 'notes/conflict.md',
						content_base64: btoa('server content'),
						content_hash: '__mock_hash__',
						size_bytes: 100,
					}],
				};
			});

			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: [
					{ path: 'notes/conflict.md', content_hash: '__mock_hash__', size_bytes: 100, seq: 9 },
				],
				conflicts: [
					{ path: 'notes/conflict.md', server_hash: '__mock_hash__', client_hash: 'a'.repeat(64), server_seq: 9 },
				],
			}));

			await manager.syncNow();

			// Local read must happen BEFORE download
			const readIdx = callOrder.indexOf('read-local');
			const downloadIdx = callOrder.indexOf('download');
			expect(readIdx).toBeGreaterThanOrEqual(0);
			expect(downloadIdx).toBeGreaterThanOrEqual(0);
			expect(readIdx).toBeLessThan(downloadIdx);
		});

		it('passes pre-read local content to conflict logger', async () => {
			const mockConflictFile = createMockTFile('notes/conflict.md');
			await asTFile(mockConflictFile);
			plugin.app.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'notes/conflict.md') return mockConflictFile;
				return null;
			});
			plugin.app.vault.read.mockResolvedValue('original local content');

			syncClient.downloadFiles.mockResolvedValue({ files: [] });

			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				conflicts: [
					{ path: 'notes/conflict.md', server_hash: 'b'.repeat(64), client_hash: 'a'.repeat(64), server_seq: 9 },
				],
			}));

			await manager.syncNow();

			expect(conflictLogger.logConflicts).toHaveBeenCalledWith(
				'session-v2',
				expect.arrayContaining([
					expect.objectContaining({ path: 'notes/conflict.md' }),
				]),
				expect.any(Map),
			);

			// Verify the Map contains the pre-read content
			const localContentsArg = conflictLogger.logConflicts.mock.calls[0]![2] as Map<string, string>;
			expect(localContentsArg.get('notes/conflict.md')).toBe('original local content');
		});

		it('logs conflicts with correct structure', async () => {
			const mockConflictFile = createMockTFile('notes/conflict.md');
			await asTFile(mockConflictFile);
			plugin.app.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'notes/conflict.md') return mockConflictFile;
				return null;
			});
			plugin.app.vault.read.mockResolvedValue('local');

			syncClient.downloadFiles.mockResolvedValue({ files: [] });

			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				conflicts: [
					{ path: 'notes/conflict.md', server_hash: 'srv'.repeat(21) + 'x', client_hash: 'cli'.repeat(21) + 'x', server_seq: 9 },
				],
			}));

			await manager.syncNow();

			const loggedConflicts = conflictLogger.logConflicts.mock.calls[0]![1];
			expect(loggedConflicts).toHaveLength(1);
			expect(loggedConflicts[0]).toMatchObject({
				path: 'notes/conflict.md',
				type: 'both-modified',
				resolution: 'both-kept',
				conflictCopyPath: 'notes/conflict.conflict.md',
			});
		});
	});

	// -----------------------------------------------------------------------
	// Batched upload via V2 flow
	// -----------------------------------------------------------------------

	describe('batched upload', () => {
		it('passes batchIndex and isLastBatch to uploadFiles', async () => {
			const hashMap = singleFileHashMap('notes/test.md');
			fileHasher.hashAllFiles.mockResolvedValue(hashMap);

			const mockFile = createMockTFile('notes/test.md');
			await asTFile(mockFile);
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				sync_session_id: 'batch-v2',
				needed_files: ['notes/test.md'],
			}));

			syncClient.uploadFiles.mockResolvedValue({
				sync_session_id: 'batch-v2',
				accepted: 1,
				rejected: 0,
				deduplicated: 0,
				indexing_triggered: true,
				rejected_files: [],
			});

			const result = await manager.syncNow();

			expect(result.success).toBe(true);
			expect(syncClient.uploadFiles).toHaveBeenCalledOnce();
			// Single file = 1 batch: batchIndex=0, isLastBatch=true
			const call = syncClient.uploadFiles.mock.calls[0]!;
			expect(call[0]).toBe('batch-v2'); // sessionId
			expect(call[2]).toBe(0); // batchIndex
			expect(call[3]).toBe(true); // isLastBatch
		});
	});

	// -----------------------------------------------------------------------
	// Sends empty manifest for server-only changes
	// -----------------------------------------------------------------------

	describe('empty manifest with prior sync', () => {
		it('sends manifest when no local changes but lastSyncSeq > 0', async () => {
			settings.lastSyncSeq = 5;
			fileHasher.hashAllFiles.mockResolvedValue(new Map()); // no local files

			await manager.syncNow();

			// Should still call sendManifestV2 to check for server changes
			expect(syncClient.sendManifestV2).toHaveBeenCalled();
		});
	});
});
