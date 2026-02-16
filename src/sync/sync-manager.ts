/**
 * SyncManager — Core orchestration for Obsidian vault sync.
 *
 * State machine:  idle → hashing → manifest → uploading → success → idle
 *                   * → error → (retry | idle)
 *
 * Responsibilities:
 *   - Vault event listeners (modify, delete, rename) with debounced auto-sync
 *   - Manual "Sync Now" trigger
 *   - Coordinates FileHasher → SyncClient.sendManifest → SyncClient.uploadFiles
 *   - Retry logic with exponential backoff (max 3 retries)
 *   - Conflict detection and logging via ConflictLogger
 *   - Progress callbacks for UI (SyncStatusBar, Week 3)
 */

import { Notice, Platform, TAbstractFile, TFile } from 'obsidian';
import type { Plugin } from 'obsidian';
import type {
	SyncState,
	SyncResult,
	SyncProgressCallback,
	FileManifestEntry,
	ConflictEntry,
	LumenSettings,
} from '../types';
import { FileHasher } from './file-hasher';
import { SyncClient } from './sync-client';
import { ConflictLogger } from './conflict-logger';
import { classifyError } from '../utils/error-classifier';
import { logger } from '../utils/logger';

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

	// Idle detection
	private visibilityHandler: (() => void) | null = null;
	private pausedWhileHidden = false;

	// Callbacks
	private stateChangeCallbacks: StateChangeCallback[] = [];
	private progressCallback: SyncProgressCallback | null = null;

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

		if (this.settings.eventSyncEnabled) {
			this.registerVisibilityHandler();
		}

		if (this.settings.syncEnabled && this.settings.autoSyncInterval > 0) {
			this.startAutoSync();
		}

		logger.info('SyncManager initialized');
	}

	/**
	 * Manual sync trigger ("Sync Now").
	 * Cancels any pending debounce and runs immediately.
	 */
	async syncNow(): Promise<SyncResult> {
		this.clearDebounce();
		return this.executeSync(true);
	}

	/** Enable debounce-based auto-sync on vault changes. */
	startAutoSync(): void {
		this.stopAutoSync();

		if (this.settings.autoSyncInterval <= 0) return;

		const intervalMs = this.settings.autoSyncInterval * 60_000;
		this.autoSyncTimer = window.setInterval(() => {
			if (!this.syncInProgress && this.pendingChanges.size > 0) {
				this.executeSync(false);
			}
		}, intervalMs);

		logger.info(`Auto-sync enabled (${this.settings.autoSyncInterval}m interval)`);
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

	/** Current sync state. */
	getState(): SyncState {
		return this.state;
	}

	/** Clean up all listeners, timers, and callbacks on plugin unload. */
	destroy(): void {
		this.clearDebounce();
		this.stopAutoSync();
		this.removeVisibilityHandler();
		if (this.successTimer !== null) {
			window.clearTimeout(this.successTimer);
			this.successTimer = null;
		}
		this.stateChangeCallbacks = [];
		this.progressCallback = null;
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
		if (this.syncInProgress) {
			logger.debug('Sync already in progress, skipping');
			return {
				success: false,
				filesUploaded: 0,
				filesDeleted: 0,
				errors: ['Sync already in progress'],
				duration: 0,
			};
		}

		this.syncInProgress = true;
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
					'1.1.0',
					vaultName,
				);

				this.settings.deviceId = deviceId;
				logger.info('Plugin registered', { deviceId, workspaceId: registration.workspace_id });
			}

			// ---- Phase 1: Hash all files ----
			this.setState('hashing');
			logger.info('Starting sync — hashing vault files...');
			const manifest = await this.fileHasher.hashAllFiles(
				(current, total) => {
					this.reportProgress('hashing', current, total, 'Hashing files...');
				},
			);

			// ---- Phase 2: Build and send manifest ----
			this.setState('manifest');
			logger.info(`Hashed ${manifest.size} files`);
			const entries = this.buildManifestEntries(manifest);

			if (entries.length === 0) {
				logger.info('No files to sync');
				this.finishSuccess(0, 0, Date.now() - startTime);
				return {
					success: true,
					filesUploaded: 0,
					filesDeleted: 0,
					errors: [],
					duration: Date.now() - startTime,
				};
			}

			const manifestResponse = await this.syncClient.sendManifest(
				entries,
				this.settings.lastSyncCursor || undefined,
			);

			logger.info(`Server requests ${manifestResponse.needed_files.length} file(s)`);

			// ---- Phase 3: Upload requested files ----
			let filesUploaded = 0;
			const errors: string[] = [];

			if (manifestResponse.needed_files.length > 0) {
				this.setState('uploading');

				const fileContents = await this.readFileContents(
					manifestResponse.needed_files,
				);

				logger.info(`Uploading ${fileContents.size} file(s)...`);
				this.reportProgress(
					'uploading',
					fileContents.size,
					fileContents.size,
					'Uploading files...',
				);

				const uploadResponse = await this.syncClient.uploadFiles(
					manifestResponse.sync_session_id,
					fileContents,
				);

				filesUploaded = uploadResponse.accepted;
				logger.info(`Upload complete: ${filesUploaded} accepted`);

				if (uploadResponse.rejected_files.length > 0) {
					for (const rf of uploadResponse.rejected_files) {
						errors.push(`${rf.path}: ${rf.reason}`);
						logger.warn(`Rejected: ${rf.path} — ${rf.reason}`);
					}
				}
			}

			// ---- Phase 4: Handle conflicts ----
			const conflicts = this.detectConflicts(manifestResponse.deleted_files);
			if (conflicts.length > 0) {
				await this.conflictLogger.logConflicts(
					manifestResponse.sync_session_id,
					conflicts,
				);
				new Notice(
					`Sync complete. ${conflicts.length} conflict(s) logged to .lumen-conflicts.md`,
				);
			}

			// ---- Phase 5: Update cursor and finalize ----
			this.settings.lastSyncCursor = manifestResponse.new_cursor;
			this.settings.lastSyncAt = new Date().toISOString();
			// Note: The caller (main.ts) is responsible for calling plugin.saveSettings()
			// after a sync. We update settings in-memory only.

			this.pendingChanges.clear();
			this.deletedPaths.clear();

			const duration = Date.now() - startTime;
			const deletedCount = manifestResponse.deleted_files.length;

			this.finishSuccess(filesUploaded, deletedCount, duration);
			logger.info(
				`Sync complete: ${filesUploaded} uploaded, ${deletedCount} deleted (${duration}ms)`,
			);

			return {
				success: true,
				filesUploaded,
				filesDeleted: deletedCount,
				errors,
				duration,
				conflicts: conflicts.length > 0 ? conflicts : undefined,
			};
		} catch (error) {
			const classified = classifyError(error);
			const duration = Date.now() - startTime;

			// Retry transient errors with exponential backoff
			if (classified.retryable && retryCount < MAX_RETRIES) {
				const delayMs = 1000 * Math.pow(2, retryCount); // 1s, 2s, 4s
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

			if (manual) {
				new Notice(`Sync failed: ${classified.message}`);
			}

			return {
				success: false,
				filesUploaded: 0,
				filesDeleted: 0,
				errors: [classified.message],
				duration,
			};
		} finally {
			this.syncInProgress = false;
		}
	}

	// -----------------------------------------------------------------------
	// Vault event handlers
	// -----------------------------------------------------------------------

	private registerVaultEvents(): void {
		// File modified
		this.plugin.registerEvent(
			this.plugin.app.vault.on('modify', (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.onFileChanged(file);
				}
			}),
		);

		// File deleted
		this.plugin.registerEvent(
			this.plugin.app.vault.on('delete', (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.onFileDeleted(file.path);
				}
			}),
		);

		// File renamed
		this.plugin.registerEvent(
			this.plugin.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.onFileRenamed(file, oldPath);
				}
			}),
		);
	}

	private onFileChanged(file: TFile): void {
		if (this.isExcluded(file.path)) return;

		this.fileHasher.invalidateCache(file.path);
		this.pendingChanges.add(file.path);
		this.scheduleDebounce();
	}

	private onFileDeleted(path: string): void {
		if (this.isExcluded(path)) return;

		this.fileHasher.invalidateCache(path);
		this.pendingChanges.delete(path);
		this.deletedPaths.add(path);
		this.scheduleDebounce();
	}

	private onFileRenamed(file: TFile, oldPath: string): void {
		this.fileHasher.invalidateCache(oldPath);

		if (!this.isExcluded(file.path)) {
			this.pendingChanges.add(file.path);
		}
		if (!this.isExcluded(oldPath)) {
			this.deletedPaths.add(oldPath);
			this.pendingChanges.delete(oldPath);
		}

		this.scheduleDebounce();
	}

	// -----------------------------------------------------------------------
	// Debounce
	// -----------------------------------------------------------------------

	private scheduleDebounce(): void {
		if (!this.settings.syncEnabled || !this.settings.eventSyncEnabled) return;

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
	 * Read vault file contents for the paths the server requested.
	 * Returns Map<path, content> for SyncClient.uploadFiles().
	 */
	private async readFileContents(
		paths: string[],
	): Promise<Map<string, string>> {
		const contents = new Map<string, string>();

		for (const path of paths) {
			try {
				const file = this.plugin.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					const content = await this.plugin.app.vault.read(file);
					contents.set(path, content);
				} else {
					logger.warn(`File not found for upload: ${path}`);
				}
			} catch (error) {
				logger.error(`Failed to read ${path} for upload:`, error);
			}
		}

		return contents;
	}

	// -----------------------------------------------------------------------
	// Conflict detection
	// -----------------------------------------------------------------------

	/**
	 * Detect conflicts from the server's deleted_files list.
	 *
	 * A conflict occurs when the server has deleted a file that we
	 * have locally modified (tracked in pendingChanges).
	 */
	private detectConflicts(serverDeletedFiles: string[]): ConflictEntry[] {
		const conflicts: ConflictEntry[] = [];

		for (const path of serverDeletedFiles) {
			if (this.pendingChanges.has(path)) {
				conflicts.push({
					path,
					type: 'server-modified',
					localHash: this.fileHasher.getCachedHash(path) ?? 'unknown',
					serverHash: '(deleted)',
					resolution: 'server-kept',
				});
			}
		}

		return conflicts;
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

	private finishSuccess(filesUploaded: number, filesDeleted: number, duration: number): void {
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

	/**
	 * Check if a path is excluded by the user's exclude patterns.
	 * Uses the same pattern logic as FileHasher.
	 */
	private isExcluded(path: string): boolean {
		return this.settings.excludePatterns.some((pattern) => {
			const regexStr = pattern
				.replace(/[.+^${}()|[\]\\]/g, '\\$&')
				.replace(/\*/g, '.*')
				.replace(/\?/g, '.');
			return new RegExp(`^${regexStr}`).test(path);
		});
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
