/**
 * Integration tests for the full sync pipeline.
 *
 * Wires real SyncManager + real FileHasher with mocked SyncClient,
 * ConflictLogger, and Vault to test the data flow between components.
 *
 * Scenarios:
 *   1. Happy path — full cycle (idle → hashing → manifest → uploading → success)
 *   2. No changes — sync with empty manifest
 *   3. Network failure recovery — first attempt fails, retry succeeds
 *   4. Session expiry (410) — non-retryable error
 *   5. Large file rejection — server rejects a file, partial success
 *   6. Conflict detection — server deletes locally-modified file
 *   7. Auto-sync debounce — multiple changes → single sync
 *   8. Manual override — "Sync Now" cancels debounce, runs immediately
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncManager } from '../../src/sync/sync-manager';
import { FileHasher } from '../../src/sync/file-hasher';
import { ConflictLogger } from '../../src/sync/conflict-logger';
import { DEFAULT_SETTINGS } from '../../src/types';
import type {
	LumenSettings,
	SyncManifestResponseV2,
	SyncUploadResponse,
	SyncState,
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
// Helpers: mock factories
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

/**
 * Create a mock TFile-like object.
 *
 * For vault events where SyncManager checks `file instanceof TFile`,
 * call `await setTFilePrototype(file)` before passing to the handler.
 */
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

/** Make a mock file pass `instanceof TFile` checks. */
async function setTFilePrototype(file: ReturnType<typeof createMockTFile>) {
	const { TFile } = await import('obsidian');
	Object.setPrototypeOf(file, TFile.prototype);
}

function createMockVault(files: ReturnType<typeof createMockTFile>[] = []) {
	const fileContents = new Map<string, string>();
	for (const f of files) {
		fileContents.set(f.path, `# ${f.basename}\n\nContent of ${f.path}`);
	}

	return {
		getMarkdownFiles: vi.fn().mockReturnValue(files),
		getFiles: vi.fn().mockReturnValue(files),
		read: vi.fn().mockImplementation(async (file: any) => {
			return fileContents.get(file.path) ?? '';
		}),
		readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
		getAbstractFileByPath: vi.fn().mockImplementation((path: string) => {
			return files.find((f) => f.path === path) ?? null;
		}),
		on: vi.fn().mockReturnValue({}),
		off: vi.fn(),
		create: vi.fn().mockResolvedValue(undefined),
		modify: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
		createFolder: vi.fn().mockResolvedValue(undefined),
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
		manifest: { version: '0.1.0' },
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
		} satisfies SyncUploadResponse),
		downloadFiles: vi.fn().mockResolvedValue({ files: [] }),
		getSyncStatus: vi.fn(),
		updateSettings: vi.fn(),
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Sync Flow Integration', () => {
	let settings: LumenSettings;
	let vault: ReturnType<typeof createMockVault>;
	let mockPlugin: ReturnType<typeof createMockPlugin>;
	let syncClient: ReturnType<typeof createMockSyncClient>;
	let fileHasher: FileHasher;
	let conflictLogger: ConflictLogger;
	let manager: SyncManager;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-02-13T12:00:00Z'));

		// SyncManager uses window.setTimeout/setInterval
		vi.stubGlobal('window', {
			setTimeout: globalThis.setTimeout.bind(globalThis),
			clearTimeout: globalThis.clearTimeout.bind(globalThis),
			setInterval: globalThis.setInterval.bind(globalThis),
			clearInterval: globalThis.clearInterval.bind(globalThis),
		});

		// FileHasher uses Web Crypto API for SHA-256
		vi.stubGlobal('crypto', {
			subtle: {
				digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(0xab).buffer),
			},
		});
	});

	afterEach(() => {
		manager?.destroy();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	/**
	 * Advance fake timers in small steps to interleave timer advancement
	 * with microtask/promise resolution. Necessary because code under test
	 * mixes setTimeout (FileHasher.yieldToUI, SyncManager.delay) with
	 * async operations (crypto.subtle.digest, mocked vault reads).
	 */
	async function advanceTimersInSteps(totalMs: number, stepMs = 100) {
		for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
			await vi.advanceTimersByTimeAsync(stepMs);
		}
	}

	/**
	 * Build the full integration stack: real SyncManager + real FileHasher
	 * + real ConflictLogger, with mocked SyncClient and Vault.
	 *
	 * Sets TFile prototype on all files so they pass `instanceof TFile`
	 * checks in SyncManager (vault events and readFileBatch).
	 */
	async function buildStack(
		files: ReturnType<typeof createMockTFile>[] = [],
		settingsOverrides: Partial<LumenSettings> = {},
	) {
		// Set TFile prototype on all mock files
		for (const file of files) {
			await setTFilePrototype(file);
		}

		settings = createSettings(settingsOverrides);
		vault = createMockVault(files);
		mockPlugin = createMockPlugin(vault);
		syncClient = createMockSyncClient();

		fileHasher = new FileHasher(vault as any, settings);
		conflictLogger = new ConflictLogger(vault as any);

		manager = new SyncManager(
			mockPlugin as any,
			settings,
			syncClient as any,
			fileHasher,
			conflictLogger,
		);
	}

	// -----------------------------------------------------------------------
	// 1. Happy path: full sync cycle
	// -----------------------------------------------------------------------

	describe('happy path — full sync cycle', () => {
		it('transitions idle → hashing → manifest → uploading → success → idle', async () => {
			const files = [
				createMockTFile('notes/daily.md', 1000, 50),
				createMockTFile('notes/project.md', 2000, 75),
			];
			await buildStack(files);

			const stateTransitions: SyncState[] = [];
			manager.onStateChange((state) => stateTransitions.push(state));

			// Server needs both files
			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 'session-happy',
				needed_files: ['notes/daily.md', 'notes/project.md'],
				new_cursor: 'cursor-happy',
			}));

			syncClient.uploadFiles.mockResolvedValue({
				sync_session_id: 'session-happy',
				accepted: 2,
				rejected: 0,
				deduplicated: 0,
				indexing_triggered: true,
				rejected_files: [],
			});

			const result = await manager.syncNow();

			expect(result.success).toBe(true);
			expect(result.filesUploaded).toBe(2);
			expect(result.errors).toHaveLength(0);

			// Verify state transitions happened in order
			expect(stateTransitions).toContain('hashing');
			expect(stateTransitions).toContain('manifest');
			expect(stateTransitions).toContain('uploading');
			expect(stateTransitions).toContain('success');

			// Verify the ordering: hashing before manifest before uploading before success
			const hashIdx = stateTransitions.indexOf('hashing');
			const manifestIdx = stateTransitions.indexOf('manifest');
			const uploadIdx = stateTransitions.indexOf('uploading');
			const successIdx = stateTransitions.indexOf('success');
			expect(hashIdx).toBeLessThan(manifestIdx);
			expect(manifestIdx).toBeLessThan(uploadIdx);
			expect(uploadIdx).toBeLessThan(successIdx);

			// After success timer, should revert to idle
			vi.advanceTimersByTime(6000);
			expect(manager.getState()).toBe('idle');
		});

		it('sends correct manifest entries with SHA-256 hashes', async () => {
			const files = [createMockTFile('notes/test.md', 1000, 50)];
			await buildStack(files);

			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 'session-hash',
				new_cursor: 'cursor-hash',
			}));

			await manager.syncNow();

			// Verify manifest was sent with hashed entries
			expect(syncClient.sendManifestV2).toHaveBeenCalledOnce();
			const [entries] = syncClient.sendManifestV2.mock.calls[0]!;
			expect(entries).toHaveLength(1);
			expect(entries[0].path).toBe('notes/test.md');
			expect(entries[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
			expect(entries[0].size_bytes).toBe(50);
			expect(entries[0].action).toBe('add');
		});

		it('uploads file contents for requested files', async () => {
			const files = [
				createMockTFile('notes/a.md', 1000, 30),
				createMockTFile('notes/b.md', 2000, 40),
			];
			await buildStack(files);

			// Server only needs one file
			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 'session-partial',
				needed_files: ['notes/a.md'],
				new_cursor: 'cursor-partial',
			}));

			syncClient.uploadFiles.mockResolvedValue({
				sync_session_id: 'session-partial',
				accepted: 1,
				rejected: 0,
				deduplicated: 0,
				indexing_triggered: true,
				rejected_files: [],
			});

			const result = await manager.syncNow();

			expect(result.success).toBe(true);
			expect(result.filesUploaded).toBe(1);

			// Verify only the requested file was uploaded
			expect(syncClient.uploadFiles).toHaveBeenCalledOnce();
			const [sessionId, fileMap] = syncClient.uploadFiles.mock.calls[0]!;
			expect(sessionId).toBe('session-partial');
			expect(fileMap).toBeInstanceOf(Map);
			expect(fileMap.size).toBe(1);
			expect(fileMap.has('notes/a.md')).toBe(true);
		});

		it('updates settings cursor and lastSyncAt after successful sync', async () => {
			const files = [createMockTFile('notes/test.md', 1000, 50)];
			await buildStack(files);

			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 'session-cursor',
				new_cursor: 'new-cursor-abc',
			}));

			await manager.syncNow();

			expect(settings.lastSyncCursor).toBe('new-cursor-abc');
			expect(settings.lastSyncAt).toBeTruthy();
		});
	});

	// -----------------------------------------------------------------------
	// 2. No changes — sync with empty manifest
	// -----------------------------------------------------------------------

	describe('no changes', () => {
		it('completes immediately when vault has no files', async () => {
			await buildStack([]);

			const result = await manager.syncNow();

			expect(result.success).toBe(true);
			expect(result.filesUploaded).toBe(0);
			expect(result.filesDeleted).toBe(0);
			// Always sends manifest now — even empty manifests discover server changes
			expect(syncClient.sendManifestV2).toHaveBeenCalled();
			expect(syncClient.uploadFiles).not.toHaveBeenCalled();
		});

		it('skips upload when server already has all files', async () => {
			const files = [createMockTFile('notes/existing.md', 1000, 50)];
			await buildStack(files);

			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 'session-noop',
				new_cursor: 'cursor-noop',
			}));

			const result = await manager.syncNow();

			expect(result.success).toBe(true);
			expect(result.filesUploaded).toBe(0);
			expect(syncClient.uploadFiles).not.toHaveBeenCalled();
		});
	});

	// -----------------------------------------------------------------------
	// 3. Network failure recovery — retry succeeds
	// -----------------------------------------------------------------------

	describe('network failure recovery', () => {
		it('retries on transient error and succeeds', async () => {
			const files = [createMockTFile('notes/retry.md', 1000, 50)];
			await buildStack(files);

			// First manifest call fails with a retryable 503
			syncClient.sendManifestV2
				.mockRejectedValueOnce(new Error('503 Service Unavailable'))
				.mockResolvedValueOnce(createDefaultV2Response({
					sync_session_id: 'session-retry',
					new_cursor: 'cursor-retry',
				}));

			// Run sync and advance timers concurrently — the retry delay
			// is a setTimeout that needs fake-timer advancement to fire.
			// Use advanceTimersInSteps to interleave timer ticks with
			// microtask resolution (crypto.subtle.digest, vault reads).
			const [result] = await Promise.all([
				manager.syncNow(),
				advanceTimersInSteps(10000),
			]);

			expect(result.success).toBe(true);
			expect(syncClient.sendManifestV2).toHaveBeenCalledTimes(2);
		});

		it('gives up after MAX_RETRIES (3) and transitions to error', async () => {
			const files = [createMockTFile('notes/fail.md', 1000, 50)];
			await buildStack(files);

			// All manifest calls fail
			syncClient.sendManifestV2.mockRejectedValue(
				new Error('502 Bad Gateway'),
			);

			const [result] = await Promise.all([
				manager.syncNow(),
				// Advance past all retry delays: 1s + 2s + 4s = 7s
				vi.advanceTimersByTimeAsync(15000),
			]);

			expect(result.success).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(manager.getState()).toBe('error');
			// Initial + 3 retries = 4 total calls
			expect(syncClient.sendManifestV2).toHaveBeenCalledTimes(4);
		});
	});

	// -----------------------------------------------------------------------
	// 4. Session expiry (410) — resets cursor and retries (max 2 resets)
	// -----------------------------------------------------------------------

	describe('session expiry', () => {
		it('handles 410 by resetting cursor and retrying, then errors after max resets', async () => {
			const files = [createMockTFile('notes/expired.md', 1000, 50)];
			await buildStack(files);

			syncClient.sendManifestV2.mockRejectedValue(
				new Error('410 SYNC_SESSION_EXPIRED'),
			);

			const result = await manager.syncNow();

			expect(result.success).toBe(false);
			expect(result.errors[0]).toContain('Sync session expired');
			expect(manager.getState()).toBe('error');
			// 1 initial + 2 reset retries = 3 total calls before giving up
			expect(syncClient.sendManifestV2).toHaveBeenCalledTimes(3);
		});
	});

	// -----------------------------------------------------------------------
	// 5. Large file rejection — partial success
	// -----------------------------------------------------------------------

	describe('large file rejection', () => {
		it('reports partial success when server rejects some files', async () => {
			const files = [
				createMockTFile('notes/good.md', 1000, 50),
				createMockTFile('notes/huge.md', 2000, 100_000_000),
			];
			await buildStack(files);

			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 'session-mixed',
				needed_files: ['notes/good.md', 'notes/huge.md'],
				new_cursor: 'cursor-mixed',
			}));

			syncClient.uploadFiles.mockResolvedValue({
				sync_session_id: 'session-mixed',
				accepted: 1,
				rejected: 1,
				deduplicated: 0,
				indexing_triggered: true,
				rejected_files: [
					{ path: 'notes/huge.md', reason: 'FILE_TOO_LARGE' },
				],
			});

			const result = await manager.syncNow();

			expect(result.success).toBe(true);
			expect(result.filesUploaded).toBe(1);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain('notes/huge.md');
			expect(result.errors[0]).toContain('FILE_TOO_LARGE');
		});
	});

	// -----------------------------------------------------------------------
	// 6. Conflict detection — server deletes locally-modified file
	// -----------------------------------------------------------------------

	describe('conflict detection', () => {
		it('logs conflicts when server reports both-modified files (V2 conflicts)', async () => {
			const files = [
				createMockTFile('notes/keep.md', 1000, 50),
				createMockTFile('notes/conflicted.md', 2000, 75),
			];
			await buildStack(files);

			// Server reports a conflict — both sides modified the same file
			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 'session-conflict',
				new_cursor: 'cursor-conflict',
				conflicts: [
					{
						path: 'notes/conflicted.md',
						server_hash: 'b'.repeat(64),
						client_hash: 'a'.repeat(64),
						server_seq: 5,
					},
				],
			}));

			const result = await manager.syncNow();

			expect(result.success).toBe(true);
			expect(result.conflicts).toBeDefined();
			expect(result.conflicts).toHaveLength(1);
			expect(result.conflicts![0].path).toBe('notes/conflicted.md');
			expect(result.conflicts![0].type).toBe('both-modified');
			expect(result.conflicts![0].resolution).toBe('both-kept');
		});
	});

	// -----------------------------------------------------------------------
	// 7. Auto-sync debounce — multiple changes → single sync
	// -----------------------------------------------------------------------

	describe('auto-sync debounce', () => {
		it('multiple rapid file changes trigger only one sync', async () => {
			const files = [
				createMockTFile('notes/a.md', 1000, 50),
				createMockTFile('notes/b.md', 2000, 75),
				createMockTFile('notes/c.md', 3000, 60),
			];
			await buildStack(files);

			await manager.initialize();

			// Get the modify handler
			const modifyCall = vault.on.mock.calls.find(
				([name]: [string]) => name === 'modify',
			);
			const modifyHandler = modifyCall![1];

			// Rapid-fire 3 file changes within the debounce window
			modifyHandler(files[0]);
			vi.advanceTimersByTime(2000); // 2s
			modifyHandler(files[1]);
			vi.advanceTimersByTime(3000); // +3s = 5s total
			modifyHandler(files[2]);

			// The debounce hasn't fired yet (resets on each change)
			expect(syncClient.sendManifestV2).not.toHaveBeenCalled();

			// Advance past the debounce window (60s from last change)
			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 'session-debounce',
				new_cursor: 'cursor-debounce',
			}));

			// Use advanceTimersInSteps so the debounce-triggered sync
			// (fire-and-forget executeSync) has microtask ticks to
			// complete its async hashing + manifest call.
			await advanceTimersInSteps(65000);

			// Only ONE sync should have been triggered
			expect(syncClient.sendManifestV2).toHaveBeenCalledTimes(1);
		});
	});

	// -----------------------------------------------------------------------
	// 8. Manual override — "Sync Now" cancels debounce
	// -----------------------------------------------------------------------

	describe('manual override', () => {
		it('syncNow cancels pending debounce and runs immediately', async () => {
			const files = [
				createMockTFile('notes/a.md', 1000, 50),
			];
			await buildStack(files);

			await manager.initialize();

			// Get the modify handler
			const modifyCall = vault.on.mock.calls.find(
				([name]: [string]) => name === 'modify',
			);
			const modifyHandler = modifyCall![1];

			// Trigger file change — starts debounce
			modifyHandler(files[0]);

			// Debounce is ticking... but user hits "Sync Now"
			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 'session-manual',
				new_cursor: 'cursor-manual',
			}));

			const result = await manager.syncNow();

			expect(result.success).toBe(true);
			expect(syncClient.sendManifestV2).toHaveBeenCalledTimes(1);

			// Advance past the debounce window — should NOT trigger another sync
			await vi.advanceTimersByTimeAsync(15000);

			// Still only 1 manifest call (the manual one)
			expect(syncClient.sendManifestV2).toHaveBeenCalledTimes(1);
		});
	});

	// -----------------------------------------------------------------------
	// Exclude pattern integration
	// -----------------------------------------------------------------------

	describe('exclude patterns', () => {
		it('excludes files matching patterns from the hash manifest', async () => {
			const files = [
				createMockTFile('notes/keep.md', 1000, 50),
				createMockTFile('.obsidian/workspace.md', 2000, 30),
				createMockTFile('.trash/deleted.md', 3000, 20),
				createMockTFile('templates/daily.md', 4000, 40),
			];
			await buildStack(files);
			fileHasher.excludePatterns = ['.obsidian/', '.trash/', 'templates/'];

			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 'session-exclude',
				new_cursor: 'cursor-exclude',
			}));

			await manager.syncNow();

			// Only 1 non-excluded file should be in the manifest
			const [entries] = syncClient.sendManifestV2.mock.calls[0]!;
			expect(entries).toHaveLength(1);
			expect(entries[0].path).toBe('notes/keep.md');
		});
	});

	// -----------------------------------------------------------------------
	// Concurrent sync prevention
	// -----------------------------------------------------------------------

	describe('concurrent sync prevention', () => {
		it('rejects second sync while first is in progress', async () => {
			const files = [createMockTFile('notes/test.md', 1000, 50)];
			await buildStack(files);

			// Make manifest slow
			let resolveManifest: (value: SyncManifestResponseV2) => void;
			syncClient.sendManifestV2.mockReturnValue(
				new Promise<SyncManifestResponseV2>((resolve) => {
					resolveManifest = resolve;
				}),
			);

			const promise1 = manager.syncNow();
			const promise2 = manager.syncNow();

			// Resolve the first sync
			resolveManifest!(createDefaultV2Response({
				sync_session_id: 'session-concurrent',
				new_cursor: 'cursor-concurrent',
			}));

			const [result1, result2] = await Promise.all([promise1, promise2]);

			expect(result1.success).toBe(true);
			expect(result2.success).toBe(false);
			expect(result2.errors[0]).toContain('already in progress');
		});
	});

	// -----------------------------------------------------------------------
	// Progress callback integration
	// -----------------------------------------------------------------------

	describe('progress callbacks', () => {
		it('reports hashing and uploading progress through the pipeline', async () => {
			// Create enough files to trigger multiple hash chunks (50 per chunk)
			const files = Array.from({ length: 75 }, (_, i) =>
				createMockTFile(`notes/file-${i}.md`, i * 1000, 50),
			);
			await buildStack(files);

			const progress: Array<{ state: SyncState; current: number; total: number }> = [];
			manager.onProgress((state, p) => {
				if (p) progress.push({ state, current: p.current, total: p.total });
			});

			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 'session-progress',
				needed_files: ['notes/file-0.md'],
				new_cursor: 'cursor-progress',
			}));

			syncClient.uploadFiles.mockResolvedValue({
				sync_session_id: 'session-progress',
				accepted: 1,
				rejected: 0,
				deduplicated: 0,
				indexing_triggered: true,
				rejected_files: [],
			});

			// syncNow needs timer advancement for yieldToUI() between hash chunks.
			// Use advanceTimersInSteps so each chunk's setTimeout(10) gets
			// resolved before the next chunk starts hashing.
			const [result] = await Promise.all([
				manager.syncNow(),
				advanceTimersInSteps(5000),
			]);

			expect(result.success).toBe(true);

			// Should have hashing progress reports (75 files / 50 per chunk = 2 chunks)
			const hashingProgress = progress.filter((p) => p.state === 'hashing');
			expect(hashingProgress.length).toBeGreaterThanOrEqual(2);
			expect(hashingProgress[0].total).toBe(75);

			// Should have an uploading progress report
			const uploadProgress = progress.filter((p) => p.state === 'uploading');
			expect(uploadProgress.length).toBeGreaterThanOrEqual(1);
		});
	});

	// -----------------------------------------------------------------------
	// End-to-end: hash consistency
	// -----------------------------------------------------------------------

	describe('hash consistency', () => {
		it('same file content produces same hash across syncs', async () => {
			const files = [createMockTFile('notes/stable.md', 1000, 50)];
			await buildStack(files);

			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 'session-1',
				new_cursor: 'cursor-1',
			}));

			await manager.syncNow();
			const hash1 = syncClient.sendManifestV2.mock.calls[0]![0][0].content_hash;

			// Second sync (cursor changes but file doesn't)
			syncClient.sendManifestV2.mockResolvedValue(createDefaultV2Response({
				sync_session_id: 'session-2',
				new_cursor: 'cursor-2',
			}));

			// Wait for success → idle transition
			vi.advanceTimersByTime(6000);

			await manager.syncNow();
			const hash2 = syncClient.sendManifestV2.mock.calls[1]![0][0].content_hash;

			expect(hash1).toBe(hash2);
			expect(hash1).toMatch(/^[0-9a-f]{64}$/);
		});
	});
});
