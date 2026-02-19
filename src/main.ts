/**
 * Lumen Search — Obsidian Plugin
 *
 * Provides semantic search of your vault via the Lumen MCP endpoint
 * and automatic vault synchronization for AI-powered note indexing.
 */

import { Menu, Notice, Plugin, TFile } from 'obsidian';
import { registerLumenIcons } from './icons';
import { ApiClient } from './api-client';
import { LumenMainView, VIEW_TYPE_LUMEN_MAIN } from './main-view';
import { LumenHelpModal } from './help-modal';
import { LumenDebugLogView, VIEW_TYPE_LUMEN_DEBUG_LOG } from './debug-log-view';
import { LumenSettingTab } from './settings-tab';
import { SimilarNotesModal } from './similar-notes-modal';
import { createLumenAPI, type LumenSearchAPI } from './dataview-api';
import { SyncManager } from './sync/sync-manager';
import { SyncClient } from './sync/sync-client';
import { SyncStatusBar } from './sync/sync-status-bar';
import { FileHasher } from './sync/file-hasher';
import { ConflictLogger } from './sync/conflict-logger';
import { logger } from './utils/logger';
import { DEFAULT_SETTINGS, type LumenSettings } from './types';

export default class LumenPlugin extends Plugin {
	settings: LumenSettings = DEFAULT_SETTINGS;
	apiClient: ApiClient = new ApiClient('', '');
	api: LumenSearchAPI | null = null;

	// Sync components — only initialized when apiKey + workspaceId are set
	syncManager: SyncManager | null = null;
	syncClient: SyncClient | null = null;
	syncStatusBar: SyncStatusBar | null = null;
	fileHasher: FileHasher | null = null;
	conflictLogger: ConflictLogger | null = null;
	private indexingPollTimer: ReturnType<typeof setInterval> | null = null;

	async onload(): Promise<void> {
		registerLumenIcons();
		await this.loadSettings();

		// Configure debug logging
		logger.setDebugMode(this.settings.debugMode);

		// Initialize API client with saved settings
		this.apiClient = new ApiClient(
			this.settings.apiUrl,
			this.settings.apiKey,
		);

		// Expose public JS API for Dataview integration
		this.api = createLumenAPI(this.apiClient);

		// Auto-resolve workspace ID from API key if missing
		if (this.settings.apiKey && !this.settings.workspaceId) {
			try {
				const status = await this.apiClient.testConnection();
				if (status.workspace_id) {
					this.settings.workspaceId = status.workspace_id;
					await this.saveData(this.settings);
				}
			} catch {
				// Server may be unreachable at startup — workspace ID will be resolved on next connection test
			}
		}

		// Initialize sync if configured
		await this.initializeSync();

		// Register the main sidebar view (Search + Chat)
		this.registerView(
			VIEW_TYPE_LUMEN_MAIN,
			(leaf) => new LumenMainView(leaf, this),
		);

		// Register the debug log view
		this.registerView(
			VIEW_TYPE_LUMEN_DEBUG_LOG,
			(leaf) => new LumenDebugLogView(leaf, this),
		);

		// Register the settings tab
		this.addSettingTab(new LumenSettingTab(this.app, this));

		// Add ribbon icon to open main sidebar
		this.addRibbonIcon('lumen-search', 'Lumen', () => {
			this.activateMainView();
		});

		// Register the search command (available via Ctrl/Cmd+P)
		this.addCommand({
			id: 'search',
			name: 'Open Lumen',
			callback: () => {
				this.activateMainView();
			},
		});

		// Register the sync command
		this.addCommand({
			id: 'sync-now',
			name: 'Sync vault with Lumen',
			callback: () => {
				this.triggerSync();
			},
		});

		// Register the help command
		this.addCommand({
			id: 'help',
			name: 'View documentation',
			callback: () => {
				new LumenHelpModal(this.app).open();
			},
		});

		// Register the debug log command
		this.addCommand({
			id: 'debug-log',
			name: 'Open Debug Log',
			callback: () => {
				this.activateDebugLogView();
			},
		});

		// Register the "Find Similar Notes" command (active file)
		this.addCommand({
			id: 'find-similar',
			name: 'Find similar notes',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'md') return false;
				if (!checking) {
					new SimilarNotesModal(this, file.path).open();
				}
				return true;
			},
		});

		// Register file-menu context item for "Find Similar Notes"
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu: Menu, file) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				menu.addItem((item) => {
					item.setTitle('Find similar notes')
						.setIcon('lumen-search')
						.onClick(() => {
							new SimilarNotesModal(this, file.path).open();
						});
				});
			}),
		);
	}

	onunload(): void {
		this.stopIndexingPoll();
		this.syncStatusBar?.destroy();
		this.syncManager?.destroy();
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_LUMEN_MAIN);
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_LUMEN_DEBUG_LOG);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);

		// Keep API client in sync with settings
		this.apiClient.updateSettings(this.settings.apiUrl, this.settings.apiKey);

		// Keep logger debug mode in sync
		logger.setDebugMode(this.settings.debugMode);

		// Update sync components if they exist
		if (this.syncClient) {
			this.syncClient.updateSettings(
				this.settings.apiUrl,
				this.settings.apiKey,
				this.settings.workspaceId,
			);
		}

		// Handle auto-sync toggle
		if (this.syncManager) {
			if (this.settings.syncEnabled && this.settings.autoSyncInterval > 0) {
				this.syncManager.startAutoSync();
			} else {
				this.syncManager.stopAutoSync();
			}
		}

		// If sync wasn't initialized but now has credentials, try initializing
		if (!this.syncManager && this.isSyncConfigured()) {
			await this.initializeSync();
		}
	}

	// -----------------------------------------------------------------------
	// Sync initialization
	// -----------------------------------------------------------------------

	/** Initialize sync components if apiKey and workspaceId are configured. */
	private async initializeSync(): Promise<void> {
		if (!this.isSyncConfigured()) {
			logger.debug('Sync not configured (missing apiKey or workspaceId)');
			return;
		}

		this.fileHasher = new FileHasher(this.app.vault, this.settings);
		this.syncClient = new SyncClient(
			this.settings.apiUrl,
			this.settings.apiKey,
			this.settings.workspaceId,
		);
		this.conflictLogger = new ConflictLogger(this.app.vault);
		this.syncManager = new SyncManager(
			this,
			this.settings,
			this.syncClient,
			this.fileHasher,
			this.conflictLogger,
		);

		await this.syncManager.initialize();

		// Create status bar and wire to sync manager
		const statusBarEl = this.addStatusBarItem();
		this.syncStatusBar = new SyncStatusBar(statusBarEl, () => {
			this.triggerSync();
		});

		// Feed state changes and progress to the status bar
		this.syncManager.onStateChange((state) => {
			this.syncStatusBar?.update(state);
		});
		this.syncManager.onProgress((state, progress) => {
			this.syncStatusBar?.update(state, progress);
		});

		// Show last sync time if available
		if (this.settings.lastSyncAt) {
			this.syncStatusBar.setLastSyncAt(this.settings.lastSyncAt);
		}

		if (this.settings.syncEnabled) {
			this.syncManager.startAutoSync();
		}

		logger.info('Sync initialized');
	}

	private isSyncConfigured(): boolean {
		return !!(this.settings.apiKey && this.settings.workspaceId);
	}

	/** Manual sync trigger — shows notice if not configured. */
	async triggerSync(): Promise<void> {
		if (!this.syncManager) {
			new Notice('Sync not configured. Set API key and workspace ID in Settings → Lumen.');
			return;
		}

		const result = await this.syncManager.syncNow();

		// Persist updated cursor and lastSyncAt from the sync
		await this.saveSettings();

		// Update status bar with new sync timestamp
		if (this.settings.lastSyncAt) {
			this.syncStatusBar?.setLastSyncAt(this.settings.lastSyncAt);
		}

		if (result.success) {
			const parts: string[] = [];
			if (result.filesUploaded > 0) parts.push(`${result.filesUploaded} uploaded`);
			if (result.filesDownloaded > 0) parts.push(`${result.filesDownloaded} downloaded`);
			if (result.filesDeleted > 0) parts.push(`${result.filesDeleted} deleted`);

			new Notice(
				parts.length > 0
					? `Synced: ${parts.join(', ')}.`
					: 'Vault is up to date.',
			);

			// Start polling indexing progress if files were uploaded
			if (result.filesUploaded > 0) {
				this.pollIndexingStatus();
			}
		} else if (result.errors.length > 0) {
			new Notice(`Sync failed: ${result.errors[0]}`);
		}
	}

	/** Poll the server for indexing status after a sync uploads files. */
	private pollIndexingStatus(): void {
		if (this.indexingPollTimer || !this.syncClient) return;
		this.indexingPollTimer = setInterval(async () => {
			try {
				const status = await this.syncClient!.getSyncStatus();
				if (status.indexing_status.active) {
					this.syncStatusBar?.showIndexingProgress(
						status.indexing_status.indexed_files,
						status.indexing_status.total_files,
						status.indexing_status.progress,
					);
				} else {
					this.stopIndexingPoll();
					this.syncStatusBar?.update('idle');
					if (this.settings.lastSyncAt) {
						this.syncStatusBar?.setLastSyncAt(this.settings.lastSyncAt);
					}
				}
			} catch {
				this.stopIndexingPoll();
			}
		}, 3000);
	}

	/** Stop the indexing status poll timer. */
	private stopIndexingPoll(): void {
		if (this.indexingPollTimer) {
			clearInterval(this.indexingPollTimer);
			this.indexingPollTimer = null;
		}
	}

	/** Activate the main sidebar view, creating it if needed */
	async activateMainView(): Promise<void> {
		const { workspace } = this.app;

		// Check if already open
		const existing = workspace.getLeavesOfType(VIEW_TYPE_LUMEN_MAIN);
		if (existing.length > 0) {
			// Reveal the existing view
			workspace.revealLeaf(existing[0]!);
			return;
		}

		// Open in the right sidebar
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({
			type: VIEW_TYPE_LUMEN_MAIN,
			active: true,
		});

		workspace.revealLeaf(leaf);
	}

	/** Activate the debug log view, creating it if needed */
	async activateDebugLogView(): Promise<void> {
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(VIEW_TYPE_LUMEN_DEBUG_LOG);
		if (existing.length > 0) {
			workspace.revealLeaf(existing[0]!);
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({
			type: VIEW_TYPE_LUMEN_DEBUG_LOG,
			active: true,
		});

		workspace.revealLeaf(leaf);
	}
}
