/**
 * handleServerChanges() tests — V2 server-to-client pull path.
 *
 * Tests the download, write, and delete operations via syncNow():
 *   - base64 decode and vault write (new file / modify existing)
 *   - Directory creation for nested paths
 *   - Batch chunking behavior (>50 files)
 *   - Deletion handling
 *   - SEC-1/SEC-2: path traversal rejection (paths with '..', leading '/', null bytes, backslashes)
 *   - Error paths (failed writes, failed deletes, failed downloads)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncManager } from '../../src/sync/sync-manager';
import { FileHasher } from '../../src/sync/file-hasher';
import { DEFAULT_SETTINGS } from '../../src/types';
import type {
	LumenSettings,
	FileManifestEntry,
	SyncManifestResponseV2,
	SyncDownloadResponse,
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

function singleFileHashMap(): Map<string, FileManifestEntry> {
	const map = new Map<string, FileManifestEntry>();
	map.set('notes/local.md', {
		path: 'notes/local.md',
		content_hash: 'a'.repeat(64),
		modified_at: new Date().toISOString(),
		size_bytes: 100,
		action: 'add',
	});
	return map;
}

function createV2Response(overrides: Partial<SyncManifestResponseV2> = {}): SyncManifestResponseV2 {
	return {
		sync_session_id: 'session-hsc',
		needed_files: [],
		deleted_files: [],
		new_cursor: 'cursor-hsc',
		upload_endpoint: '/api/workspaces/ws-001/sync/upload',
		current_seq: 10,
		server_changes: [],
		server_deletions: [],
		conflicts: [],
		download_endpoint: '/api/workspaces/ws-001/sync/download',
		...overrides,
	};
}

function createMockFileHasher() {
	return {
		hashAllFiles: vi.fn().mockResolvedValue(singleFileHashMap()),
		hashFile: vi.fn().mockResolvedValue('a'.repeat(64)),
		invalidateCache: vi.fn(),
		get cacheSize() { return 0; },
	};
}

function createMockSyncClient() {
	return {
		register: vi.fn(),
		sendManifestV2: vi.fn().mockResolvedValue(createV2Response()),
		uploadFiles: vi.fn().mockResolvedValue({
			sync_session_id: 'session-hsc',
			accepted: 0, rejected: 0, deduplicated: 0,
			indexing_triggered: false, rejected_files: [],
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

async function asTFile(mock: ReturnType<typeof createMockTFile>) {
	const { TFile } = await import('obsidian');
	Object.setPrototypeOf(mock, TFile.prototype);
	return mock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleServerChanges (via syncNow)', () => {
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
		fileHasher = createMockFileHasher();
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
	// base64 decode + vault write
	// -----------------------------------------------------------------------

	describe('base64 decode and write', () => {
		it('decodes base64 content and creates new file', async () => {
			const content = '# New File from Server\n\nHello world';
			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: [
					{ path: 'notes/new-file.md', content_hash: '__mock_hash__', size_bytes: content.length, seq: 8 },
				],
			}));
			syncClient.downloadFiles.mockResolvedValue({
				files: [{
					path: 'notes/new-file.md',
					content_base64: btoa(content),
					content_hash: '__mock_hash__',
					size_bytes: content.length,
				}],
			});

			// File doesn't exist locally
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			const result = await manager.syncNow();

			expect(plugin.app.vault.create).toHaveBeenCalledWith('notes/new-file.md', content);
			expect(result.filesDownloaded).toBe(1);
		});

		it('decodes base64 and modifies existing file', async () => {
			const content = '# Updated Content';
			const mockFile = createMockTFile('notes/existing.md');
			await asTFile(mockFile);

			plugin.app.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'notes/existing.md') return mockFile;
				return null;
			});

			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: [
					{ path: 'notes/existing.md', content_hash: '__mock_hash__', size_bytes: content.length, seq: 9 },
				],
			}));
			syncClient.downloadFiles.mockResolvedValue({
				files: [{
					path: 'notes/existing.md',
					content_base64: btoa(content),
					content_hash: '__mock_hash__',
					size_bytes: content.length,
				}],
			});

			const result = await manager.syncNow();

			expect(plugin.app.vault.modify).toHaveBeenCalledWith(mockFile, content);
			expect(result.filesDownloaded).toBe(1);
		});

		it('uses binary hash path for text files (non-ASCII safe)', async () => {
			const content = '# Café ☕ — 日本語テスト';
			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: [
					{ path: 'notes/unicode.md', content_hash: '__mock_hash__', size_bytes: content.length, seq: 8 },
				],
			}));
			syncClient.downloadFiles.mockResolvedValue({
				files: [{
					path: 'notes/unicode.md',
					content_base64: btoa(unescape(encodeURIComponent(content))),
					content_hash: '__mock_hash__',
					size_bytes: content.length,
				}],
			});

			plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			const result = await manager.syncNow();

			// Text files now hash via computeSHA256Binary (byte-level), not computeSHA256 (string)
			expect(FileHasher.computeSHA256Binary).toHaveBeenCalled();
			expect(result.filesDownloaded).toBe(1);
		});

		it('invalidates file hasher cache after writing', async () => {
			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: [
					{ path: 'notes/cached.md', content_hash: '__mock_hash__', size_bytes: 10, seq: 7 },
				],
			}));
			syncClient.downloadFiles.mockResolvedValue({
				files: [{
					path: 'notes/cached.md',
					content_base64: btoa('content'),
					content_hash: '__mock_hash__',
					size_bytes: 10,
				}],
			});

			await manager.syncNow();

			expect(fileHasher.invalidateCache).toHaveBeenCalledWith('notes/cached.md');
		});
	});

	// -----------------------------------------------------------------------
	// Directory creation for nested paths
	// -----------------------------------------------------------------------

	describe('directory creation', () => {
		it('creates parent directories for deeply nested paths', async () => {
			const content = '# Deep File';
			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: [
					{ path: 'a/b/c/deep.md', content_hash: '__mock_hash__', size_bytes: 10, seq: 6 },
				],
			}));
			syncClient.downloadFiles.mockResolvedValue({
				files: [{
					path: 'a/b/c/deep.md',
					content_base64: btoa(content),
					content_hash: '__mock_hash__',
					size_bytes: 10,
				}],
			});
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			await manager.syncNow();

			// Should have created parent directories
			expect(plugin.app.vault.createFolder).toHaveBeenCalled();
			expect(plugin.app.vault.create).toHaveBeenCalledWith('a/b/c/deep.md', content);
		});
	});

	// -----------------------------------------------------------------------
	// Batch chunking (>50 files)
	// -----------------------------------------------------------------------

	describe('batch chunking', () => {
		it('downloads files in batches of 50', async () => {
			// Create 120 server changes
			const serverChanges = Array.from({ length: 120 }, (_, i) => ({
				path: `notes/file-${i}.md`,
				content_hash: `${i}`.padStart(64, '0'),
				size_bytes: 10,
				seq: i,
			}));

			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: serverChanges,
			}));

			// Each downloadFiles call returns its batch
			syncClient.downloadFiles.mockImplementation(async (_sid: string, paths: string[]) => ({
				files: paths.map(p => ({
					path: p,
					content_base64: btoa('content'),
					content_hash: '__mock_hash__',
					size_bytes: 7,
				})),
			}));

			plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			const result = await manager.syncNow();

			// 120 files / 50 per batch = 3 batches
			expect(syncClient.downloadFiles).toHaveBeenCalledTimes(3);

			// First batch: 50 paths
			const firstBatch = syncClient.downloadFiles.mock.calls[0]![1] as string[];
			expect(firstBatch).toHaveLength(50);

			// Second batch: 50 paths
			const secondBatch = syncClient.downloadFiles.mock.calls[1]![1] as string[];
			expect(secondBatch).toHaveLength(50);

			// Third batch: 20 paths
			const thirdBatch = syncClient.downloadFiles.mock.calls[2]![1] as string[];
			expect(thirdBatch).toHaveLength(20);

			expect(result.filesDownloaded).toBe(120);
		});

		it('uses server-provided download_endpoint for all batches', async () => {
			const serverChanges = Array.from({ length: 60 }, (_, i) => ({
				path: `notes/batch-${i}.md`,
				content_hash: `${i}`.padStart(64, '0'),
				size_bytes: 10,
				seq: i,
			}));

			const customEndpoint = '/api/workspaces/ws-001/sync/download/v2';
			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: serverChanges,
				download_endpoint: customEndpoint,
			}));

			syncClient.downloadFiles.mockResolvedValue({ files: [] });

			await manager.syncNow();

			// Both batches should use the custom endpoint
			for (const call of syncClient.downloadFiles.mock.calls) {
				expect(call[2]).toBe(customEndpoint);
			}
		});
	});

	// -----------------------------------------------------------------------
	// Deletion handling
	// -----------------------------------------------------------------------

	describe('deletion handling', () => {
		it('deletes files listed in server_deletions', async () => {
			const mockFile = createMockTFile('notes/to-delete.md');
			await asTFile(mockFile);
			plugin.app.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'notes/to-delete.md') return mockFile;
				return null;
			});

			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_deletions: ['notes/to-delete.md'],
			}));

			const result = await manager.syncNow();

			expect(plugin.app.vault.delete).toHaveBeenCalledWith(mockFile);
			expect(fileHasher.invalidateCache).toHaveBeenCalledWith('notes/to-delete.md');
		});

		it('handles multiple deletions', async () => {
			const files = ['a.md', 'b.md', 'c.md'];
			const mockFiles = new Map<string, any>();

			for (const path of files) {
				const mf = createMockTFile(path);
				await asTFile(mf);
				mockFiles.set(path, mf);
			}

			plugin.app.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				return mockFiles.get(p) ?? null;
			});

			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_deletions: files,
			}));

			const result = await manager.syncNow();

			expect(plugin.app.vault.delete).toHaveBeenCalledTimes(3);
		});

		it('continues deleting remaining files when one fails', async () => {
			const file1 = createMockTFile('notes/ok.md');
			const file2 = createMockTFile('notes/fail.md');
			await asTFile(file1);
			await asTFile(file2);

			plugin.app.vault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'notes/ok.md') return file1;
				if (p === 'notes/fail.md') return file2;
				return null;
			});

			plugin.app.vault.delete.mockImplementation(async (file: any) => {
				if (file.path === 'notes/fail.md') throw new Error('Permission denied');
			});

			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_deletions: ['notes/fail.md', 'notes/ok.md'],
			}));

			const result = await manager.syncNow();

			// Should still succeed overall
			expect(result.success).toBe(true);
			expect(result.errors.length).toBeGreaterThanOrEqual(1);
			expect(result.errors.some(e => e.includes('notes/fail.md'))).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// SEC-1/SEC-2: Path traversal rejection
	// -----------------------------------------------------------------------

	describe('SEC-1/SEC-2: path traversal rejection', () => {
		it('rejects paths with ".." segments (SEC-1: write)', async () => {
			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: [
					{ path: '../../../etc/passwd', content_hash: 'x'.repeat(64), size_bytes: 10, seq: 1 },
				],
			}));
			syncClient.downloadFiles.mockResolvedValue({
				files: [{
					path: '../../../etc/passwd',
					content_base64: btoa('malicious'),
					content_hash: 'x'.repeat(64),
					size_bytes: 10,
				}],
			});

			const result = await manager.syncNow();

			expect(plugin.app.vault.create).not.toHaveBeenCalled();
			expect(plugin.app.vault.modify).not.toHaveBeenCalled();
			expect(result.errors.some(e => e.includes('Unsafe path'))).toBe(true);
		});

		it('rejects paths starting with "/" (SEC-1: write)', async () => {
			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: [
					{ path: '/etc/shadow', content_hash: 'x'.repeat(64), size_bytes: 10, seq: 1 },
				],
			}));
			syncClient.downloadFiles.mockResolvedValue({
				files: [{
					path: '/etc/shadow',
					content_base64: btoa('root'),
					content_hash: 'x'.repeat(64),
					size_bytes: 10,
				}],
			});

			const result = await manager.syncNow();

			expect(plugin.app.vault.create).not.toHaveBeenCalled();
			expect(result.errors.some(e => e.includes('Unsafe path'))).toBe(true);
		});

		it('rejects paths with null bytes (SEC-1: write)', async () => {
			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: [
					{ path: 'notes/file\0.md', content_hash: 'x'.repeat(64), size_bytes: 10, seq: 1 },
				],
			}));
			syncClient.downloadFiles.mockResolvedValue({
				files: [{
					path: 'notes/file\0.md',
					content_base64: btoa('null byte'),
					content_hash: 'x'.repeat(64),
					size_bytes: 10,
				}],
			});

			const result = await manager.syncNow();

			expect(plugin.app.vault.create).not.toHaveBeenCalled();
			expect(result.errors.some(e => e.includes('Unsafe path'))).toBe(true);
		});

		it('rejects paths with backslashes (SEC-1: write)', async () => {
			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: [
					{ path: 'notes\\..\\secret.md', content_hash: 'x'.repeat(64), size_bytes: 10, seq: 1 },
				],
			}));
			syncClient.downloadFiles.mockResolvedValue({
				files: [{
					path: 'notes\\..\\secret.md',
					content_base64: btoa('backslash'),
					content_hash: 'x'.repeat(64),
					size_bytes: 10,
				}],
			});

			const result = await manager.syncNow();

			expect(plugin.app.vault.create).not.toHaveBeenCalled();
			expect(result.errors.some(e => e.includes('Unsafe path'))).toBe(true);
		});

		it('rejects ".." in server_deletions (SEC-2: delete)', async () => {
			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_deletions: ['../../important-system-file'],
			}));

			const result = await manager.syncNow();

			expect(plugin.app.vault.delete).not.toHaveBeenCalled();
			expect(result.errors.some(e => e.includes('Unsafe path'))).toBe(true);
		});

		it('rejects absolute paths in server_deletions (SEC-2: delete)', async () => {
			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_deletions: ['/etc/hosts'],
			}));

			const result = await manager.syncNow();

			expect(plugin.app.vault.delete).not.toHaveBeenCalled();
			expect(result.errors.some(e => e.includes('Unsafe path'))).toBe(true);
		});

		it('allows safe paths while rejecting unsafe ones in same batch', async () => {
			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: [
					{ path: 'notes/safe.md', content_hash: '__mock_hash__', size_bytes: 10, seq: 1 },
					{ path: '../escape.md', content_hash: '__mock_hash__', size_bytes: 10, seq: 2 },
				],
			}));
			syncClient.downloadFiles.mockResolvedValue({
				files: [
					{ path: 'notes/safe.md', content_base64: btoa('safe'), content_hash: '__mock_hash__', size_bytes: 4 },
					{ path: '../escape.md', content_base64: btoa('evil'), content_hash: '__mock_hash__', size_bytes: 4 },
				],
			});
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			const result = await manager.syncNow();

			// Safe file should be written
			expect(plugin.app.vault.create).toHaveBeenCalledWith('notes/safe.md', 'safe');
			// Unsafe file should be rejected
			expect(result.errors.some(e => e.includes('Unsafe path'))).toBe(true);
			expect(result.filesDownloaded).toBe(1);
		});
	});

	// -----------------------------------------------------------------------
	// Error paths
	// -----------------------------------------------------------------------

	describe('error paths', () => {
		it('handles vault write failure gracefully', async () => {
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
			plugin.app.vault.create.mockRejectedValue(new Error('Disk full'));

			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: [
					{ path: 'notes/fail-write.md', content_hash: '__mock_hash__', size_bytes: 10, seq: 1 },
				],
			}));
			syncClient.downloadFiles.mockResolvedValue({
				files: [{
					path: 'notes/fail-write.md',
					content_base64: btoa('content'),
					content_hash: '__mock_hash__',
					size_bytes: 10,
				}],
			});

			const result = await manager.syncNow();

			expect(result.success).toBe(true); // sync overall succeeds
			expect(result.errors.some(e => e.includes('notes/fail-write.md'))).toBe(true);
			expect(result.filesDownloaded).toBe(0);
		});

		it('handles download batch failure gracefully', async () => {
			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: [
					{ path: 'notes/batch-fail.md', content_hash: 'g'.repeat(64), size_bytes: 10, seq: 1 },
				],
			}));
			syncClient.downloadFiles.mockRejectedValue(new Error('Network timeout'));

			const result = await manager.syncNow();

			expect(result.success).toBe(true);
			expect(result.errors.some(e => e.includes('Download batch failed'))).toBe(true);
			expect(result.filesDownloaded).toBe(0);
		});

		it('continues processing after a batch failure', async () => {
			// 60 files: first batch of 50 fails, second batch of 10 succeeds
			const serverChanges = Array.from({ length: 60 }, (_, i) => ({
				path: `notes/file-${i}.md`,
				content_hash: `${i}`.padStart(64, '0'),
				size_bytes: 10,
				seq: i,
			}));

			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: serverChanges,
			}));

			syncClient.downloadFiles
				.mockRejectedValueOnce(new Error('Batch 1 failed'))
				.mockResolvedValueOnce({
					files: Array.from({ length: 10 }, (_, i) => ({
						path: `notes/file-${50 + i}.md`,
						content_base64: btoa('ok'),
						content_hash: '__mock_hash__',
						size_bytes: 2,
					})),
				});

			plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			const result = await manager.syncNow();

			// First batch failed, second succeeded
			expect(syncClient.downloadFiles).toHaveBeenCalledTimes(2);
			expect(result.filesDownloaded).toBe(10);
			expect(result.errors.some(e => e.includes('Download batch failed'))).toBe(true);
		});

		it('shows Notice on hash mismatch', async () => {
			const { Notice } = await import('obsidian');

			// Return a hash that doesn't match the mock
			vi.spyOn(FileHasher, 'computeSHA256Binary').mockResolvedValueOnce('wrong_hash');

			syncClient.sendManifestV2.mockResolvedValue(createV2Response({
				server_changes: [
					{ path: 'notes/mismatch.md', content_hash: 'expected_hash', size_bytes: 10, seq: 1 },
				],
			}));
			syncClient.downloadFiles.mockResolvedValue({
				files: [{
					path: 'notes/mismatch.md',
					content_base64: btoa('content'),
					content_hash: 'expected_hash',
					size_bytes: 10,
				}],
			});

			const result = await manager.syncNow();

			expect(result.filesDownloaded).toBe(0);
			expect(result.errors.some(e => e.includes('Hash mismatch'))).toBe(true);
			expect(Notice).toHaveBeenCalledWith(
				expect.stringContaining('hash mismatch'),
				5000,
			);
		});
	});

	// -----------------------------------------------------------------------
	// Null guard on V2 response fields
	// -----------------------------------------------------------------------

	describe('null-guard on V2 response fields', () => {
		it('handles missing server_changes gracefully', async () => {
			const response = createV2Response();
			// Simulate server omitting server_changes
			(response as any).server_changes = undefined;
			syncClient.sendManifestV2.mockResolvedValue(response);

			const result = await manager.syncNow();

			expect(result.success).toBe(true);
			expect(result.filesDownloaded).toBe(0);
		});

		it('handles missing server_deletions gracefully', async () => {
			const response = createV2Response();
			// Simulate server omitting server_deletions
			(response as any).server_deletions = undefined;
			syncClient.sendManifestV2.mockResolvedValue(response);

			const result = await manager.syncNow();

			expect(result.success).toBe(true);
		});
	});
});
