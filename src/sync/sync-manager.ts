/**
 * SyncManager — Core orchestration for Obsidian vault sync.
 *
 * State machine:  idle → hashing → manifest → uploading → success → idle
 *                   * → error → (retry | idle)
 *
 * Responsibilities:
 *   - Vault event listeners (modify, delete, rename) with debounced auto-sync
 *   - Manual "Sync Now" trigger
 *   - Coordinates FileHasher → SyncClient.sendManifestV2 → SyncClient.uploadFiles
 *   - Retry logic with exponential backoff (max 3 retries)
 *   - Conflict detection and logging via ConflictLogger
 */

import { Notice, Platform, TAbstractFile, TFile } from 'obsidian';
import type { Plugin } from 'obsidian';
import type {
	SyncState,
	SyncResult,
	SyncProgressCallback,
	SyncUploadResponse,
	FileManifestEntry,
	ConflictEntry,
	SyncManifestResponseV2,
	LumenSettings,
} from '../types';
import { FileHasher } from './file-hasher';
import { SyncClient } from './sync-client';
import { ConflictLogger } from './conflict-logger';
import { classifyError } from '../utils/error-classifier';
import { logger } from '../utils/logger';
import { isExcludedByPatterns } from '../utils/exclude-pattern';
import { isSafePath } from '../utils/path-safety';
import { TEXT_EXTENSIONS, UPLOAD_BATCH_SIZE, BATCH_MAX_RETRIES, BATCH_RETRY_BASE_MS, NOTICE_DURATION_ERROR_MS } from './constants';
import { networkStatus } from '../utils/network-status';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Milliseconds to wait after the last file change before auto-syncing. */
const DEBOUNCE_MS = 60_000; // 60 seconds

/** Maximum retry attempts for transient errors. */
const MAX_RETRIES = 3;

/** Milliseconds the "success" state is shown before reverting to idle. */
const SUCCESS_DISPLAY_MS = 5_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StateChangeCallback = (state: SyncState, message?: string) => void;

// ---------------------------------------------------------------------------
// SyncManager
// ---------------------------------------------------------------------------

export class SyncManager {
	// Dependencies
	private plugin: Plugin;
	private settings: LumenSettings;
	private syncClient: SyncClient;
	private fileHasher: FileHasher;
	private conflictLogger: ConflictLogger;

	// State
	private state: SyncState = 'idle';
	private syncInProgress = false;
	private pendingChanges: Set<string> = new Set();
	private deletedPaths: Set<string> = new Set();

	// Timers
	private debounceTimer: number | null = null;
	private autoSyncTimer: number | null = null;
	private successTimer: number | null = null;

	// Batch upload timing for ETA calculation
	private batchDurations: number[] = [];

	// Cancellation
	private syncAbortController: AbortController | null = null;

	// Sync config (applied via applySyncConfig)
	private syncEnabled = true;
	private autoSyncIntervalMinutes = 5;
	private eventSyncEnabled = true;

	// Cached sync config from server
	private currentExcludePatterns: string[] = ['.obsidian/', '.trash/'];
	private currentMaxFileSize: number = 50 * 1024 * 1024;

	// Network status
	private networkUnsubscribe: (() => void) | null = null;

	// Idle detection
	private visibilityHandler: (() => void) | null = null;
	private pausedWhileHidden = false;

	// Callbacks
	private stateChangeCallbacks: StateChangeCallback[] = [];
	private progressCallback: SyncProgressCallback | null = null;
	private syncCompleteCallbacks: ((result: SyncResult) => void)[] = [];

	constructor(
		plugin: Plugin,
		settings: LumenSettings,
		syncClient: SyncClient,
		fileHasher: FileHasher,
		conflictLogger: ConflictLogger,
	) {
		this.plugin = plugin;
		this.settings = settings;
		this.syncClient = syncClient;
		this.fileHasher = fileHasher;
		this.conflictLogger = conflictLogger;
	}

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------

	/**
	 * Initialize the sync manager.
	 * Registers vault event listeners and starts auto-sync if enabled.
	 */
	async initialize(): Promise<void> {
		this.registerVaultEvents();

		if (this.eventSyncEnabled) {
			this.registerVisibilityHandler();
		}

		// Subscribe to network status — auto-sync when coming back online
		this.networkUnsubscribe = networkStatus.onChange((online) => {
			if (online && !this.syncInProgress && (this.pendingChanges.size > 0 || this.deletedPaths.size > 0)) {
				logger.info('Network restored — scheduling deferred sync');
				this.scheduleDebounce();
			}
		});

		logger.info('SyncManager initialized');
	}

	/** Apply server-managed sync configuration. */
	applySyncConfig(config: { sync_enabled: boolean; sync_interval_minutes: number; event_sync_enabled: boolean }): void {
		this.syncEnabled = config.sync_enabled;
		this.autoSyncIntervalMinutes = config.sync_interval_minutes;
		this.eventSyncEnabled = config.event_sync_enabled;
	}

	/**
	 * Manual sync trigger ("Sync Now").
	 * Cancels any pending debounce and runs immediately.
	 */
	async syncNow(): Promise<SyncResult> {
		this.clearDebounce();
		return this.executeSync(true);
	}

	/**
	 * Cancel an in-progress sync.
	 * Aborts pending HTTP requests and resets state to idle.
	 */
	cancelSync(): void {
		if (this.syncAbortController) {
			this.syncAbortController.abort();
			this.syncAbortController = null;
		}
		this.syncInProgress = false;
		this.setState('cancelled');
		logger.info('Sync cancelled by user');
	}

	/** Enable debounce-based auto-sync on vault changes. */
	startAutoSync(): void {
		this.stopAutoSync();

		if (this.autoSyncIntervalMinutes <= 0) return;

		const intervalMs = this.autoSyncIntervalMinutes * 60_000;
		this.autoSyncTimer = window.setInterval(() => {
			if (!this.syncInProgress && this.pendingChanges.size > 0) {
				this.executeSync(false);
			}
		}, intervalMs);

		logger.info(`Auto-sync enabled (${this.autoSyncIntervalMinutes}m interval)`);
	}

	/** Disable periodic auto-sync. */
	stopAutoSync(): void {
		if (this.autoSyncTimer !== null) {
			window.clearInterval(this.autoSyncTimer);
			this.autoSyncTimer = null;
			logger.info('Auto-sync disabled');
		}
	}

	/** Register a callback for state transitions. */
	onStateChange(callback: StateChangeCallback): void {
		this.stateChangeCallbacks.push(callback);
	}

	/** Register a progress callback (for SyncStatusBar). */
	onProgress(callback: SyncProgressCallback): void {
		this.progressCallback = callback;
	}

	/** Register a callback for sync completion (success or failure). */
	onSyncComplete(callback: (result: SyncResult) => void): void {
		this.syncCompleteCallbacks.push(callback);
	}

	/** Current sync state. */
	getState(): SyncState {
		return this.state;
	}

	/** Clean up all listeners, timers, and callbacks on plugin unload. */
	destroy(): void {
		this.clearDebounce();
		this.stopAutoSync();
		this.removeVisibilityHandler();
		if (this.networkUnsubscribe) {
			this.networkUnsubscribe();
			this.networkUnsubscribe = null;
		}
		if (this.syncAbortController) {
			this.syncAbortController.abort();
			this.syncAbortController = null;
		}
		if (this.successTimer !== null) {
			window.clearTimeout(this.successTimer);
			this.successTimer = null;
		}
		this.stateChangeCallbacks = [];
		this.progressCallback = null;
		this.syncCompleteCallbacks = [];
		this.pendingChanges.clear();
		this.deletedPaths.clear();
		logger.info('SyncManager destroyed');
	}

	// -----------------------------------------------------------------------
	// Core sync execution
	// -----------------------------------------------------------------------

	private async executeSync(
		manual: boolean,
		retryCount = 0,
	): Promise<SyncResult> {
		// Skip sync when offline
		if (!networkStatus.online) {
			logger.info('Offline — sync deferred');
			this.setState('offline');
			return {
				success: false,
				filesUploaded: 0,
				filesDownloaded: 0,
				filesDeleted: 0,
				errors: ['Offline — sync deferred'],
				duration: 0,
			};
		}

		if (this.syncInProgress) {
			logger.debug('Sync already in progress, skipping');
			return {
				success: false,
				filesUploaded: 0,
				filesDownloaded: 0,
				filesDeleted: 0,
				errors: ['Sync already in progress'],
				duration: 0,
			};
		}

		this.syncInProgress = true;
		this.syncAbortController = new AbortController();
		const signal = this.syncAbortController.signal;
		const startTime = Date.now();

		try {
			// ---- Phase 0: Auto-register if workspace isn't configured for plugin sync ----
			if (!this.settings.deviceId) {
				logger.info('No device ID found, registering plugin with server...');
				const deviceId = crypto.randomUUID();
				const deviceName = `${Platform.isDesktop ? 'desktop' : 'mobile'}-${deviceId.slice(0, 8)}`;
				const vaultName = this.plugin.app.vault.getName();

				const registration = await this.syncClient.register(
					deviceId,
					deviceName,
					this.plugin.manifest.version,
					vaultName,
					Platform.isDesktop ? 'desktop' : 'mobile',
				);

				// Cache exclude patterns from registration response
				if (registration.exclude_patterns?.length) {
					this.currentExcludePatterns = registration.exclude_patterns;
					this.fileHasher.excludePatterns = registration.exclude_patterns;
				}

				this.settings.deviceId = deviceId;
				logger.info('Plugin registered', { deviceId, workspaceId: registration.workspace_id });
			}

			// ---- Phase 0.5: Fetch sync config (exclude patterns + size limits) ----
			try {
				const syncConfig = await this.syncClient.getSyncStatus();
				if (syncConfig.exclude_patterns?.length) {
					this.fileHasher.excludePatterns = syncConfig.exclude_patterns;
					this.currentExcludePatterns = syncConfig.exclude_patterns;
				}
				if (syncConfig.max_file_size_bytes) {
					this.fileHasher.maxFileSize = syncConfig.max_file_size_bytes;
					this.currentMaxFileSize = syncConfig.max_file_size_bytes;
				}
			} catch {
				// Server may not support config fields yet — use defaults
				logger.debug('Could not fetch sync config, using defaults');
			}

			// ---- Phase 1: Hash all files ----
			this.setState('hashing');
			logger.info('Starting sync — hashing vault files...');
			const manifest = await this.fileHasher.hashAllFiles(
				(current, total) => {
					this.reportProgress('hashing', current, total, 'Hashing files...');
				},
			);

			// ---- Phase 2: Build and send manifest (V2) ----
			this.setState('manifest');
			logger.info(`Hashed ${manifest.size} files`);
			const entries = this.buildManifestEntries(manifest);

			if (entries.length > 10_000) {
				new Notice(
					`Too many files (${entries.length}) for sync. Max is 10,000. ` +
					'Add exclude patterns on your Lumen server to reduce the file count.',
					10000,
				);
				logger.error(`Manifest too large: ${entries.length} files exceeds 10,000 limit`);
				this.setState('error');
				const result: SyncResult = {
					success: false,
					filesUploaded: 0,
					filesDownloaded: 0,
					filesDeleted: 0,
					errors: ['MANIFEST_TOO_LARGE: Too many files for sync (max 10,000). Add exclude patterns on the server.'],
					duration: Date.now() - startTime,
				};
				this.notifySyncComplete(result);
				return result;
			}

			// Always send manifest — even empty manifests discover server changes

			// Check for cancellation before manifest exchange
			if (signal.aborted) {
				return this.cancelledResult(startTime);
			}

			const manifestResponse = await this.syncClient.sendManifestV2(
				entries,
				this.settings.deviceId,
				this.settings.lastSyncSeq,
				this.settings.lastSyncCursor || undefined,
				signal,
			);

			const serverChanges = manifestResponse.server_changes ?? [];
			logger.info(
				`Server requests ${manifestResponse.needed_files.length} upload(s), ${serverChanges.length} download(s)`,
			);

			// Log files rejected by server at manifest stage (unsupported extensions)
			if (manifestResponse.rejected_files?.length) {
				logger.info(`Server rejected ${manifestResponse.rejected_files.length} file(s) from manifest:`);
				for (const r of manifestResponse.rejected_files) {
					logger.info(`  - ${r.path}: ${r.reason}`);
				}
			}

			// ---- Phase 3: Upload requested files (batched) ----
			let filesUploaded = 0;
			const errors: string[] = [];

			if (manifestResponse.needed_files.length > 0) {
				this.setState('uploading');
				const allPaths = manifestResponse.needed_files;
				const totalBatches = Math.ceil(allPaths.length / UPLOAD_BATCH_SIZE);
				this.batchDurations = [];

				for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
					const batchStart = batchIdx * UPLOAD_BATCH_SIZE;
					const batchPaths = allPaths.slice(batchStart, batchStart + UPLOAD_BATCH_SIZE);
					const isLastBatch = batchIdx === totalBatches - 1;

					const batchStartTime = Date.now();

					// Check for cancellation before each batch
					if (signal.aborted) {
						return this.cancelledResult(startTime);
					}

					const uploadResponse = await this.uploadBatchWithRetry(
						manifestResponse.sync_session_id,
						batchPaths,
						batchIdx,
						isLastBatch,
						signal,
					);

					const batchMs = Date.now() - batchStartTime;
					this.batchDurations.push(batchMs);
					if (this.batchDurations.length > 5) this.batchDurations.shift();

					filesUploaded += uploadResponse.accepted;

					if (uploadResponse.rejected_files?.length) {
						logger.warn(`Batch ${batchIdx}: ${uploadResponse.rejected_files.length} file(s) rejected`);
						for (const rf of uploadResponse.rejected_files) {
							logger.debug(`  Rejected: ${rf.path} — ${rf.reason}`);
							errors.push(`${rf.path}: ${rf.reason}`);
						}
					}

					// Report progress with ETA
					const avgBatchMs = this.batchDurations.reduce((a, b) => a + b, 0) / this.batchDurations.length;
					const remainingBatches = totalBatches - (batchIdx + 1);
					const etaSeconds = remainingBatches > 0 ? Math.ceil((avgBatchMs * remainingBatches) / 1000) : null;

					this.reportProgress('uploading', filesUploaded, allPaths.length,
						`Uploading ${filesUploaded}/${allPaths.length} (batch ${batchIdx + 1}/${totalBatches})${etaSeconds !== null ? ` ~${etaSeconds}s` : ''}`
					);
				}
			}

			// ---- Phase 3.5: Pre-read conflict files BEFORE downloading (BUG-1 fix) ----
			const conflictLocalContents = new Map<string, string>();
			const v2Conflicts = manifestResponse.conflicts ?? [];
			if (v2Conflicts.length > 0) {
				await Promise.all(v2Conflicts.map(async (c) => {
					const content = await this.readSingleFile(c.path);
					if (content !== null) {
						conflictLocalContents.set(c.path, content);
					}
				}));
			}

			// ---- Phase 4: Download server changes ----
			let filesDownloaded = 0;
			let filesDeletedLocally = 0;

			const downloadResult = await this.handleServerChanges(manifestResponse, manifest);
			filesDownloaded = downloadResult.downloaded;
			filesDeletedLocally = downloadResult.deleted;
			errors.push(...downloadResult.errors);

			// ---- Phase 5: Handle conflicts ----
			const conflicts: ConflictEntry[] = [];

			if (v2Conflicts.length > 0) {
				for (const c of v2Conflicts) {
					conflicts.push({
						path: c.path,
						type: 'both-modified',
						localHash: c.client_hash,
						serverHash: c.server_hash,
						resolution: 'server-kept',
					});
				}

				await this.conflictLogger.logConflicts(
					manifestResponse.sync_session_id,
					conflicts,
					conflictLocalContents,
				);

				if (conflicts.length > 0) {
					new Notice(
						`Sync complete. ${conflicts.length} conflict(s) logged to .lumen-conflicts.md`,
					);
				}
			}

			// ---- Phase 6: Update cursor/seq and finalize ----
			this.settings.lastSyncCursor = manifestResponse.new_cursor;
			this.settings.lastSyncSeq = manifestResponse.current_seq;
			this.settings.lastSyncAt = new Date().toISOString();

			// BUG-2 fix: persist settings after every successful sync (not just manual)
			await this.plugin.saveData(this.settings);

			this.pendingChanges.clear();
			this.deletedPaths.clear();

			const duration = Date.now() - startTime;
			const totalDeleted = manifestResponse.deleted_files.length + filesDeletedLocally;

			this.finishSuccess();
			logger.info(
				`Sync complete: ${filesUploaded} uploaded, ${filesDownloaded} downloaded, ${totalDeleted} deleted (${duration}ms)`,
			);

			const result: SyncResult = {
				success: true,
				filesUploaded,
				filesDownloaded,
				filesDeleted: totalDeleted,
				errors,
				duration,
				conflicts: conflicts.length > 0 ? conflicts : undefined,
			};
			this.notifySyncComplete(result);
			return result;
		} catch (error) {
			// Handle cancellation cleanly — not an error
			if (error instanceof Error && error.name === 'AbortError') {
				return this.cancelledResult(startTime);
			}

			const classified = classifyError(error);
			const duration = Date.now() - startTime;

			// 410 Gone — sync session expired. Reset cursor+seq and auto-restart.
			if (classified.statusCode === 410) {
				logger.warn('410 Gone — resetting sync state and restarting');
				this.settings.lastSyncCursor = '';
				this.settings.lastSyncSeq = 0;
				this.syncInProgress = false;
				return this.executeSync(manual, 0);
			}

			// Retry transient errors with exponential backoff + jitter
			if (classified.retryable && retryCount < MAX_RETRIES) {
				const baseMs = 1000 * Math.pow(2, retryCount); // 1s, 2s, 4s
				const jitter = Math.floor(Math.random() * baseMs * 0.5); // 0-50% jitter
				const delayMs = baseMs + jitter;
				logger.warn(
					`Retryable error (attempt ${retryCount + 1}/${MAX_RETRIES}), ` +
					`retrying in ${delayMs}ms: ${classified.message}`,
				);
				this.syncInProgress = false;
				await this.delay(delayMs);
				return this.executeSync(manual, retryCount + 1);
			}

			// Non-retryable or max retries exceeded
			this.setState('error');
			logger.error('Sync failed:', classified.message);

			new Notice(
				`Lumen sync failed: ${classified.message}. ${Platform.isMobile ? 'Tap' : 'Click'} the status bar to retry.`,
				NOTICE_DURATION_ERROR_MS,
			);

			const result: SyncResult = {
				success: false,
				filesUploaded: 0,
				filesDownloaded: 0,
				filesDeleted: 0,
				errors: [classified.message],
				duration,
			};
			this.notifySyncComplete(result);
			return result;
		} finally {
			this.syncAbortController = null;
			this.syncInProgress = false;
		}
	}

	// -----------------------------------------------------------------------
	// Server → Plugin download (V2 pull path)
	// -----------------------------------------------------------------------

	/** Download batch size for server changes. */
	private static readonly DOWNLOAD_BATCH_SIZE = 50;

	/**
	 * Handle server changes from a V2 manifest response.
	 *
	 * Downloads new/modified files and deletes locally-removed files.
	 * SEC-1/SEC-2 fix: all server-controlled paths are validated before use.
	 * BUG-3 fix: uses server-provided download_endpoint.
	 */
	private async handleServerChanges(
		v2Response: SyncManifestResponseV2,
		localManifest: Map<string, FileManifestEntry>,
	): Promise<{ downloaded: number; deleted: number; errors: string[] }> {
		const errors: string[] = [];
		let downloaded = 0;
		let deleted = 0;

		// ---- Download new/modified files ----
		// Filter server changes when doing full sync — skip files where local hash matches
		const allServerChanges = v2Response.server_changes ?? [];
		let changesToProcess = allServerChanges;
		if ((v2Response.requires_full_sync || this.settings.lastSyncSeq === 0) && changesToProcess.length > 0) {
			changesToProcess = changesToProcess.filter(change => {
				const local = localManifest.get(change.path);
				return !(local && local.content_hash === change.content_hash);
			});
			if (changesToProcess.length < allServerChanges.length) {
				logger.info(`Full sync: skipped ${allServerChanges.length - changesToProcess.length} files matching local hashes`);
			}
		}

		if (changesToProcess.length > 0) {
			this.setState('downloading');
			const paths = changesToProcess.map(c => c.path);
			logger.info(`Downloading ${paths.length} file(s) from server...`);

			// Process in batches
			for (let i = 0; i < paths.length; i += SyncManager.DOWNLOAD_BATCH_SIZE) {
				const batch = paths.slice(i, i + SyncManager.DOWNLOAD_BATCH_SIZE);
				this.reportProgress(
					'downloading',
					i,
					paths.length,
					'Downloading files...',
				);

				try {
					const response = await this.syncClient.downloadFiles(
						v2Response.sync_session_id,
						batch,
						v2Response.download_endpoint,
						this.syncAbortController?.signal,
					);

					for (const file of response.files) {
						// SEC-1: validate path before writing
						if (!isSafePath(file.path)) {
							const msg = `Unsafe path rejected (write): ${file.path}`;
							errors.push(msg);
							logger.warn(msg);
							continue;
						}

						try {
							// Decode base64 to raw bytes first — hash the bytes, not a
							// re-encoded string. This avoids a mismatch for non-ASCII
							// content (accented chars, CJK, emoji) where atob+TextEncoder
							// round-trip produces different bytes than the upload path.
							const bytes = Uint8Array.from(atob(file.content_base64), c => c.charCodeAt(0));
							const hash = await FileHasher.computeSHA256Binary(bytes);
							if (hash !== file.content_hash) {
								const msg = `Hash mismatch for ${file.path}: expected ${file.content_hash.slice(0, 8)}…, got ${hash.slice(0, 8)}…`;
								errors.push(msg);
								logger.warn(msg);
								new Notice(`Sync: hash mismatch for ${file.path} — file skipped`, 5000);
								continue;
							}

							const ext = file.path.split('.').pop()?.toLowerCase() ?? '';
							if (TEXT_EXTENSIONS.has(ext)) {
								const content = new TextDecoder('utf-8').decode(bytes);
								await this.writeToVault(file.path, content);
							} else {
								await this.writeToVaultBinary(file.path, bytes.buffer as ArrayBuffer);
							}
							this.fileHasher.invalidateCache(file.path);
							downloaded++;
						} catch (writeErr) {
							const msg = `Failed to write ${file.path}: ${writeErr instanceof Error ? writeErr.message : 'unknown'}`;
							errors.push(msg);
							logger.error(msg);
						}
					}
				} catch (batchErr) {
					const msg = `Download batch failed: ${batchErr instanceof Error ? batchErr.message : 'unknown'}`;
					errors.push(msg);
					logger.error(msg);
				}
			}

			logger.info(`Downloaded ${downloaded}/${paths.length} file(s)`);
		}

		// ---- Delete locally-removed files ----
		const serverDeletions = v2Response.server_deletions ?? [];
		if (serverDeletions.length > 0) {
			logger.info(`Deleting ${serverDeletions.length} file(s) removed from server...`);

			for (const path of serverDeletions) {
				// SEC-2: validate path before deleting
				if (!isSafePath(path)) {
					const msg = `Unsafe path rejected (delete): ${path}`;
					errors.push(msg);
					logger.warn(msg);
					continue;
				}

				try {
					const file = this.plugin.app.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) {
						await this.plugin.app.vault.delete(file);
						this.fileHasher.invalidateCache(path);
						deleted++;
						logger.debug(`Deleted local file: ${path}`);
					} else {
						logger.debug(`File not found for deletion (already removed?): ${path}`);
					}
				} catch (delErr) {
					const msg = `Failed to delete ${path}: ${delErr instanceof Error ? delErr.message : 'unknown'}`;
					errors.push(msg);
					logger.error(msg);
				}
			}

			logger.info(`Deleted ${deleted}/${serverDeletions.length} file(s)`);
		}

		return { downloaded, deleted, errors };
	}

	/**
	 * Write content to a vault file, creating parent folders and the
	 * file itself if they don't exist.
	 */
	private async writeToVault(path: string, content: string): Promise<void> {
		const existing = this.plugin.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.plugin.app.vault.modify(existing, content);
		} else {
			// Ensure parent directories exist
			const dir = path.substring(0, path.lastIndexOf('/'));
			if (dir) {
				await this.ensureDirectory(dir);
			}
			await this.plugin.app.vault.create(path, content);
		}
	}

	/**
	 * Write binary content to a vault file, creating parent folders
	 * and the file itself if they don't exist.
	 */
	private async writeToVaultBinary(path: string, data: ArrayBuffer): Promise<void> {
		const existing = this.plugin.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.plugin.app.vault.modifyBinary(existing, data);
		} else {
			const dir = path.substring(0, path.lastIndexOf('/'));
			if (dir) {
				await this.ensureDirectory(dir);
			}
			await this.plugin.app.vault.createBinary(path, data);
		}
	}

	/** Recursively create directories if they don't exist. */
	private async ensureDirectory(dirPath: string): Promise<void> {
		const existing = this.plugin.app.vault.getAbstractFileByPath(dirPath);
		if (existing) return;

		const parent = dirPath.substring(0, dirPath.lastIndexOf('/'));
		if (parent) {
			await this.ensureDirectory(parent);
		}

		try {
			await this.plugin.app.vault.createFolder(dirPath);
		} catch {
			// Folder may have been created concurrently — ignore
		}
	}

	/** Read a single file's content, returning null if not found. */
	private async readSingleFile(path: string): Promise<string | null> {
		try {
			const file = this.plugin.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				return await this.plugin.app.vault.read(file);
			}
		} catch {
			// File may not exist
		}
		return null;
	}

	// -----------------------------------------------------------------------
	// Vault event handlers
	// -----------------------------------------------------------------------

	private registerVaultEvents(): void {
		this.plugin.registerEvent(
			this.plugin.app.vault.on('modify', (file: TAbstractFile) => {
				if (this.isSyncableFile(file)) {
					this.onFileChanged(file);
				}
			}),
		);

		this.plugin.registerEvent(
			// Deleted files may have stale/undefined stat, so we check only path exclusion
			// (not isSyncableFile which requires stat.size)
			this.plugin.app.vault.on('delete', (file: TAbstractFile) => {
				if (file instanceof TFile && !isExcludedByPatterns(file.path, this.currentExcludePatterns)) {
					this.onFileDeleted(file.path);
				}
			}),
		);

		this.plugin.registerEvent(
			this.plugin.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				if (file instanceof TFile) {
					this.onFileRenamed(file, oldPath);
				}
			}),
		);
	}

	private isSyncableFile(file: TAbstractFile): file is TFile {
		return file instanceof TFile
			&& !isExcludedByPatterns(file.path, this.currentExcludePatterns)
			&& file.stat.size <= this.currentMaxFileSize;
	}

	private onFileChanged(file: TFile): void {
		// isSyncableFile already filtered at the event boundary
		this.fileHasher.invalidateCache(file.path);
		this.pendingChanges.add(file.path);
		this.scheduleDebounce();
	}

	private onFileDeleted(path: string): void {
		// isExcludedByPatterns(path, currentExcludePatterns) already checked at event boundary
		this.fileHasher.invalidateCache(path);
		this.pendingChanges.delete(path);
		this.deletedPaths.add(path);
		this.scheduleDebounce();
	}

	private onFileRenamed(file: TFile, oldPath: string): void {
		this.fileHasher.invalidateCache(oldPath);

		// New path: only track if syncable (not excluded, within size limit)
		if (!isExcludedByPatterns(file.path, this.currentExcludePatterns)
			&& file.stat.size <= this.currentMaxFileSize) {
			this.pendingChanges.add(file.path);
		}
		// Old path: always process deletion if it wasn't excluded on the server
		if (!isExcludedByPatterns(oldPath, this.currentExcludePatterns)) {
			this.deletedPaths.add(oldPath);
			this.pendingChanges.delete(oldPath);
		}

		this.scheduleDebounce();
	}

	// -----------------------------------------------------------------------
	// Debounce
	// -----------------------------------------------------------------------

	private scheduleDebounce(): void {
		if (!this.syncEnabled || !this.eventSyncEnabled) return;

		// If the window is hidden, defer sync until it becomes visible
		if (typeof document !== 'undefined' && document.hidden) {
			this.pausedWhileHidden = true;
			logger.debug('Window hidden — deferring debounce sync until foreground');
			return;
		}

		this.clearDebounce();
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			if (!this.syncInProgress && (this.pendingChanges.size > 0 || this.deletedPaths.size > 0)) {
				this.executeSync(false);
			}
		}, DEBOUNCE_MS);
	}

	private clearDebounce(): void {
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	// -----------------------------------------------------------------------
	// Manifest building
	// -----------------------------------------------------------------------

	/**
	 * Build FileManifestEntry[] from the hash map plus tracked deletions.
	 *
	 * For files in the hash map, the action is 'add' (server determines
	 * whether it actually needs the file via hash comparison).
	 * For tracked deletions, the action is 'delete'.
	 */
	private buildManifestEntries(
		hashMap: Map<string, FileManifestEntry>,
	): FileManifestEntry[] {
		const entries: FileManifestEntry[] = [];

		// All hashed files — server decides which ones it actually needs
		for (const entry of hashMap.values()) {
			entries.push(entry);
		}

		// Tracked deletions since last sync
		for (const path of this.deletedPaths) {
			if (!hashMap.has(path)) {
				entries.push({
					path,
					content_hash: '',
					modified_at: new Date().toISOString(),
					size_bytes: 0,
					action: 'delete',
				});
			}
		}

		return entries;
	}

	// -----------------------------------------------------------------------
	// File reading (for upload)
	// -----------------------------------------------------------------------

	/**
	 * Read vault file contents for a batch of paths.
	 * Returns Map<path, content> for SyncClient.uploadFiles().
	 */
	private async readFileBatch(
		paths: string[],
	): Promise<Map<string, string | ArrayBuffer>> {
		const contents = new Map<string, string | ArrayBuffer>();

		for (const path of paths) {
			try {
				const file = this.plugin.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					if (TEXT_EXTENSIONS.has(file.extension)) {
						contents.set(path, await this.plugin.app.vault.read(file));
					} else {
						contents.set(path, await this.plugin.app.vault.readBinary(file));
					}
				} else {
					logger.warn(`File not found for upload: ${path}`);
				}
			} catch (error) {
				logger.error(`Failed to read ${path} for upload:`, error);
			}
		}

		return contents;
	}

	/**
	 * Upload a single batch with retry logic.
	 * Retries transient errors with exponential backoff up to BATCH_MAX_RETRIES.
	 */
	private async uploadBatchWithRetry(
		sessionId: string,
		batchPaths: string[],
		batchIndex: number,
		isLastBatch: boolean,
		signal?: AbortSignal,
		retryCount = 0,
	): Promise<SyncUploadResponse> {
		try {
			const batchContents = await this.readFileBatch(batchPaths);
			return await this.syncClient.uploadFiles(sessionId, batchContents, batchIndex, isLastBatch, signal);
		} catch (error) {
			// Don't retry if cancelled
			if (error instanceof Error && error.name === 'AbortError') {
				throw error;
			}
			const classified = classifyError(error);
			if (classified.retryable && retryCount < BATCH_MAX_RETRIES) {
				const baseMs = BATCH_RETRY_BASE_MS * Math.pow(2, retryCount);
				const jitter = Math.floor(Math.random() * baseMs * 0.5);
				const delayMs = baseMs + jitter;
				logger.warn(`Batch ${batchIndex} failed (attempt ${retryCount + 1}/${BATCH_MAX_RETRIES}), retrying in ${delayMs}ms`);
				await new Promise(resolve => setTimeout(resolve, delayMs));
				return this.uploadBatchWithRetry(sessionId, batchPaths, batchIndex, isLastBatch, signal, retryCount + 1);
			}
			throw error;
		}
	}

	// -----------------------------------------------------------------------
	// State management
	// -----------------------------------------------------------------------

	private setState(newState: SyncState): void {
		this.state = newState;
		for (const cb of this.stateChangeCallbacks) {
			try {
				cb(newState);
			} catch {
				// Don't let callback errors break the sync flow
			}
		}
	}

	/** Return a clean "cancelled" result (not an error). */
	private cancelledResult(startTime: number): SyncResult {
		const duration = Date.now() - startTime;
		logger.info(`Sync cancelled after ${duration}ms`);
		this.setState('cancelled');
		const result: SyncResult = {
			success: false,
			filesUploaded: 0,
			filesDownloaded: 0,
			filesDeleted: 0,
			errors: ['Sync cancelled'],
			duration,
		};
		this.notifySyncComplete(result);
		return result;
	}

	private finishSuccess(): void {
		this.setState('success');

		// Revert to idle after a delay
		this.successTimer = window.setTimeout(() => {
			this.successTimer = null;
			if (this.state === 'success') {
				this.setState('idle');
			}
		}, SUCCESS_DISPLAY_MS);
	}

	private reportProgress(
		state: SyncState,
		current: number,
		total: number,
		message: string,
	): void {
		this.progressCallback?.(state, { current, total, message });
	}

	// -----------------------------------------------------------------------
	// Idle detection (visibilitychange)
	// -----------------------------------------------------------------------

	private registerVisibilityHandler(): void {
		if (typeof document === 'undefined') return;
		this.removeVisibilityHandler();

		this.visibilityHandler = () => {
			if (!document.hidden && this.pausedWhileHidden) {
				this.pausedWhileHidden = false;
				logger.debug('Window visible — resuming deferred sync');
				if (this.pendingChanges.size > 0 || this.deletedPaths.size > 0) {
					this.scheduleDebounce();
				}
			}
		};

		document.addEventListener('visibilitychange', this.visibilityHandler);
	}

	private removeVisibilityHandler(): void {
		if (typeof document === 'undefined' || !this.visibilityHandler) return;
		document.removeEventListener('visibilitychange', this.visibilityHandler);
		this.visibilityHandler = null;
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	private notifySyncComplete(result: SyncResult): void {
		for (const cb of this.syncCompleteCallbacks) {
			try {
				cb(result);
			} catch {
				// Don't let callback errors break the sync flow
			}
		}
	}


	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
