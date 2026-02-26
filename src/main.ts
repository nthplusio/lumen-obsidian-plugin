/**
 * Lumen Search — Obsidian Plugin
 *
 * Provides semantic search of your vault via the Lumen MCP endpoint
 * and automatic vault synchronization for AI-powered note indexing.
 */

import { Menu, Notice, Plugin, TFile } from 'obsidian';
import { registerLumenIcons } from './icons';
import { ApiClient } from './api-client';
import { ChatClient } from './chat-client';
import { LumenMainView, VIEW_TYPE_LUMEN_MAIN } from './main-view';
import { LumenHelpModal } from './help-modal';
import { LumenDebugLogView, VIEW_TYPE_LUMEN_DEBUG_LOG } from './debug-log-view';
import { LumenSettingTab } from './settings-tab';
import { SimilarNotesModal } from './similar-notes-modal';
import { QuickSearchModal } from './quick-search-modal';
import { createLumenAPI, type LumenSearchAPI } from './dataview-api';
import { SyncManager } from './sync/sync-manager';
import { SyncClient } from './sync/sync-client';
import { SyncStatusBar } from './sync/sync-status-bar';
import { FileHasher } from './sync/file-hasher';
import { ConflictLogger } from './sync/conflict-logger';
import { logger } from './utils/logger';
import { networkStatus } from './utils/network-status';
import { DEFAULT_SETTINGS, type ConflictEntry, type LumenSettings } from './types';

export default class LumenPlugin extends Plugin {
	settings: LumenSettings = DEFAULT_SETTINGS;
	apiClient: ApiClient = new ApiClient('');
	chatClient: ChatClient | null = null;
	api: LumenSearchAPI | null = null;

	/** Recent sync conflicts for the UI — cleared when user dismisses */
	recentConflicts: ConflictEntry[] = [];
	private conflictListeners: Array<(conflicts: ConflictEntry[]) => void> = [];

	/** Register a listener for conflict changes (returns unsubscribe fn) */
	onConflictsChange(cb: (conflicts: ConflictEntry[]) => void): () => void {
		this.conflictListeners.push(cb);
		return () => {
			this.conflictListeners = this.conflictListeners.filter(l => l !== cb);
		};
	}

	private notifyConflictListeners(): void {
		for (const cb of this.conflictListeners) cb(this.recentConflicts);
	}

	/** Clear all recent conflicts (user dismissed) */
	dismissConflicts(): void {
		this.recentConflicts = [];
		this.notifyConflictListeners();
	}

	// Sync components — only initialized when apiKey + workspaceId are set
	syncManager: SyncManager | null = null;
	syncClient: SyncClient | null = null;
	syncStatusBar: SyncStatusBar | null = null;
	fileHasher: FileHasher | null = null;
	conflictLogger: ConflictLogger | null = null;
	private indexingPollTimer: ReturnType<typeof setInterval> | null = null;
	private backgroundPollTimer: ReturnType<typeof setInterval> | null = null;
	private pluginTriggeredIndexing = false;

	async onload(): Promise<void> {
		registerLumenIcons();
		await this.loadSettings();

		// Configure debug logging
		logger.setDebugMode(this.settings.debugMode);

		// Initialize API client with saved API key
		this.apiClient = new ApiClient(this.settings.apiKey);

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

		// Initialize clients if configured
		if (this.settings.apiKey && this.settings.workspaceId) {
			this.chatClient = new ChatClient(
				this.settings.apiKey,
				this.settings.workspaceId,
			);
			// Pre-cache plan info (non-blocking)
			this.chatClient.getWorkspacePlan().catch(() => {});
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

		// Register the cancel sync command
		this.addCommand({
			id: 'cancel-sync',
			name: 'Cancel active sync',
			checkCallback: (checking: boolean) => {
				if (!this.syncManager) return false;
				if (!checking) {
					this.syncManager.cancelSync();
					new Notice('Sync cancelled.');
				}
				return true;
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

		// Quick search modal (Ctrl/Cmd+Shift+L)
		this.addCommand({
			id: 'quick-search',
			name: 'Quick search',
			callback: () => {
				new QuickSearchModal(this).open();
			},
		});

		// Focus the search input in the sidebar
		this.addCommand({
			id: 'focus-search',
			name: 'Focus search input',
			callback: () => {
				this.activateMainView().then(() => {
					const view = this.getMainView();
					view?.appRef.current?.focusSearch();
				});
			},
		});

		// Switch to chat tab
		this.addCommand({
			id: 'open-chat',
			name: 'Open chat',
			callback: () => {
				this.activateMainView().then(() => {
					const view = this.getMainView();
					view?.appRef.current?.setMode('chat');
				});
			},
		});

		// New chat conversation
		this.addCommand({
			id: 'new-chat',
			name: 'New chat',
			callback: () => {
				this.activateMainView().then(() => {
					const view = this.getMainView();
					view?.appRef.current?.setMode('chat');
				});
			},
		});

		// Toggle between search, chat, and related
		this.addCommand({
			id: 'toggle-mode',
			name: 'Toggle search / chat / related',
			callback: () => {
				this.activateMainView().then(() => {
					const view = this.getMainView();
					if (!view?.appRef.current) return;
					// Determine current mode from DOM and cycle forward
					if (document.querySelector('.lumen-related-view')) {
						view.appRef.current.setMode('search');
					} else if (document.querySelector('.lumen-chat-view')) {
						view.appRef.current.setMode('related');
					} else {
						view.appRef.current.setMode('chat');
					}
				});
			},
		});

		// Open related notes tab
		this.addCommand({
			id: 'open-related',
			name: 'Open related notes',
			callback: () => {
				this.activateMainView().then(() => {
					const view = this.getMainView();
					view?.appRef.current?.setMode('related');
				});
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
		this.stopBackgroundPoll();
		this.stopIndexingPoll();
		this.syncStatusBar?.destroy();
		this.syncManager?.destroy();
		networkStatus.destroy();
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_LUMEN_MAIN);
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_LUMEN_DEBUG_LOG);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);

		// Keep API client in sync with settings
		this.apiClient.updateSettings(this.settings.apiKey);

		// Keep logger debug mode in sync
		logger.setDebugMode(this.settings.debugMode);

		// Keep ChatClient in sync with settings
		if (this.chatClient) {
			this.chatClient.updateSettings(
				this.settings.apiKey,
				this.settings.workspaceId,
			);
		} else if (this.settings.apiKey && this.settings.workspaceId) {
			// Create ChatClient if now configured
			this.chatClient = new ChatClient(
				this.settings.apiKey,
				this.settings.workspaceId,
			);
		}

		// Update sync components if they exist
		if (this.syncClient) {
			this.syncClient.updateSettings(
				this.settings.apiKey,
				this.settings.workspaceId,
			);
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
		this.syncStatusBar = new SyncStatusBar(
			statusBarEl,
			() => this.triggerSync(),
			() => this.syncManager?.cancelSync(),
		);

		// Feed state changes and progress to the status bar
		this.syncManager.onStateChange((state) => {
			this.syncStatusBar?.update(state);
		});
		this.syncManager.onProgress((state, progress) => {
			this.syncStatusBar?.update(state, progress);
		});

		// Handle sync completion — persist settings, poll indexing, surface conflicts
		this.syncManager.onSyncComplete(async (result) => {
			await this.saveSettings();
			if (this.settings.lastSyncAt) {
				this.syncStatusBar?.setLastSyncAt(this.settings.lastSyncAt);
			}
			if (result.success && result.filesUploaded > 0) {
				this.pluginTriggeredIndexing = true;
				this.pollIndexingStatus();
			}
			// Surface conflicts to the UI
			if (result.conflicts && result.conflicts.length > 0) {
				this.recentConflicts = result.conflicts;
				this.notifyConflictListeners();
			}
		});

		// Show last sync time if available
		if (this.settings.lastSyncAt) {
			this.syncStatusBar.setLastSyncAt(this.settings.lastSyncAt);
		}

		// Start auto-sync — the sync manager gets its config from the server
		// during each sync cycle (registration + sync status endpoints)
		this.syncManager.startAutoSync();

		logger.info('Sync initialized');

		// Auto-sync on first connect to pull existing workspace files
		if (!this.settings.lastSyncAt && this.settings.lastSyncSeq === 0) {
			setTimeout(() => {
				if (this.syncManager) {
					logger.info('First connect — triggering initial sync to pull workspace files');
					this.syncManager.syncNow();
				}
			}, 2000);
		}

		// Check if the server is currently indexing (e.g. from a previous sync)
		this.syncClient.getSyncStatus().then(status => {
			if (status.indexing_status.active) this.pollIndexingStatus();
		}).catch(() => {});

		this.startBackgroundPoll();
	}

	private isSyncConfigured(): boolean {
		return !!(this.settings.apiKey && this.settings.workspaceId);
	}

	/** Manual sync trigger — shows notice if not configured. */
	async triggerSync(): Promise<void> {
		if (!this.syncManager) {
			new Notice('Sync not configured. Set your API key in Settings → Lumen.');
			return;
		}

		const result = await this.syncManager.syncNow();

		// Settings persistence, status bar update, and indexing poll
		// are handled by the onSyncComplete callback in initializeSync().
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
		} else if (result.errors.length > 0) {
			new Notice(`Sync failed: ${result.errors[0]}`);
		}
	}

	/** Poll the server for indexing status after a sync uploads files. */
	private pollIndexingStatus(): void {
		if (this.indexingPollTimer || !this.syncClient) return;
		const serverTriggered = !this.pluginTriggeredIndexing;
		this.indexingPollTimer = setInterval(async () => {
			try {
				const status = await this.syncClient!.getSyncStatus();
				if (status.indexing_status.active) {
					this.syncStatusBar?.showIndexingProgress(
						status.indexing_status.indexed_files,
						status.indexing_status.total_files,
						status.indexing_status.progress,
						serverTriggered,
					);
				} else {
					this.stopIndexingPoll();
					this.pluginTriggeredIndexing = false;
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

	/** Low-frequency background poll to detect server-initiated reindexing. */
	private startBackgroundPoll(): void {
		if (this.backgroundPollTimer) return;
		this.backgroundPollTimer = setInterval(async () => {
			// Skip if rapid poll is already running or sync client unavailable
			if (this.indexingPollTimer || !this.syncClient) return;
			try {
				const status = await this.syncClient.getSyncStatus();
				if (status.indexing_status.active) {
					this.pollIndexingStatus();
				}
			} catch {
				// Server unreachable — silently ignore
			}
		}, 30_000);
	}

	/** Stop the background indexing detection poll. */
	private stopBackgroundPoll(): void {
		if (this.backgroundPollTimer) {
			clearInterval(this.backgroundPollTimer);
			this.backgroundPollTimer = null;
		}
	}

	/** Get the main view instance if it exists */
	private getMainView(): LumenMainView | null {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_LUMEN_MAIN);
		if (leaves.length > 0) {
			return leaves[0]!.view as LumenMainView;
		}
		return null;
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
