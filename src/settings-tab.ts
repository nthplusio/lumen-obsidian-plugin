/**
 * Settings Tab for Lumen plugin.
 *
 * Three collapsible sections: Connection, Vault Sync, and Advanced.
 * Connection section is API-key-only (server URL is baked in).
 * Vault Sync settings are read-only — managed via the Lumen dashboard.
 */

import { App, Notice, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type LumenPlugin from './main';
import { LumenHelpModal } from './help-modal';
import { LUMEN_API_URL } from './types';
import { formatRelativeTime } from './sync/sync-status-bar';
import { logger } from './utils/logger';
import type { LogEntryListener } from './utils/logger';

export class LumenSettingTab extends PluginSettingTab {
	plugin: LumenPlugin;
	private _activityLogListener: LogEntryListener | null = null;
	private _lastSyncValueEl: HTMLElement | null = null;
	private _syncStateValueEl: HTMLElement | null = null;
	private _connectionStatusEl: HTMLElement | null = null;
	private _lastConnectionResult: { type: 'success' | 'error' | 'info'; message: string } | null = null;

	constructor(app: App, plugin: LumenPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const titleRow = containerEl.createEl('div', { cls: 'lumen-settings-title-row' });
		titleRow.createEl('h2', { text: 'Lumen Settings' });
		titleRow.createEl('span', {
			text: `v${this.plugin.manifest.version}`,
			cls: 'lumen-settings-version',
		});

		const subtitleRow = containerEl.createEl('div', { cls: 'lumen-settings-subtitle-row' });
		subtitleRow.createEl('span', {
			text: 'Connect your Obsidian vault to Lumen for AI-powered semantic search.',
			cls: 'setting-item-description',
		});
		const docsBtn = subtitleRow.createEl('button', {
			text: 'View Documentation',
			cls: 'lumen-docs-button',
		});
		docsBtn.addEventListener('click', () => {
			new LumenHelpModal(this.app).open();
		});

		this.renderConnectionSection(containerEl);
		this.renderSyncSection(containerEl);
		this.renderAdvancedSection(containerEl);
	}

	// -----------------------------------------------------------------------
	// Connection Section
	// -----------------------------------------------------------------------

	private renderConnectionSection(containerEl: HTMLElement): void {
		const content = this.createSection(containerEl, 'Connection', true);

		// --- Server URL (read-only label) ---
		new Setting(content)
			.setName('Server')
			.setDesc(LUMEN_API_URL);

		// --- API Key ---
		const keySetting = new Setting(content)
			.setName('API Key')
			.setDesc('Your Lumen API key (starts with vr_). Get one from your Lumen dashboard.');

		keySetting.addText(text => {
			text
				.setPlaceholder('vr_...')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					const trimmed = value.trim();
					this.plugin.settings.apiKey = trimmed;
					await this.plugin.saveSettings();
					this.updateKeyValidation(keySetting, trimmed);
				});
			text.inputEl.type = 'password';
			text.inputEl.autocomplete = 'off';
		});

		this.updateKeyValidation(keySetting, this.plugin.settings.apiKey);

		// --- Connection Status ---
		this._connectionStatusEl = content.createEl('div', { cls: 'lumen-status' });
		this.renderConnectionStatus();

		// --- Test Connection / Connect ---
		new Setting(content)
			.setName('Test Connection')
			.setDesc('Verify connectivity and fetch workspace configuration')
			.addButton(button =>
				button
					.setButtonText('Test Connection')
					.setCta()
					.onClick(async () => {
						if (!this.plugin.settings.apiKey) {
							new Notice('Please enter your API key first');
							return;
						}

						button.setButtonText('Connecting...');
						button.setDisabled(true);
						this.clearConnectionStatus();

						try {
							const status = await this.plugin.apiClient.testConnection();
							const chunkCount = status.chunk_count ?? 0;

							// Auto-populate workspace ID from authenticated response
							if (status.workspace_id && !this.plugin.settings.workspaceId) {
								this.plugin.settings.workspaceId = status.workspace_id;
								await this.plugin.saveSettings();
							}

							this.showConnectionStatus(
								'success',
								`Connected \u2014 ${chunkCount} chunks indexed`,
							);

							new Notice('Connected!');

							// Re-render to show updated sync info
							this.display();
						} catch (err) {
							const errorMsg = this.formatConnectionError(err);
							this.showConnectionStatus('error', errorMsg);
							new Notice(`Connection failed: ${errorMsg}`);
						} finally {
							button.setButtonText('Test Connection');
							button.setDisabled(false);
						}
					})
			);
	}

	// -----------------------------------------------------------------------
	// Vault Sync Section (read-only, server-managed)
	// -----------------------------------------------------------------------

	private renderSyncSection(containerEl: HTMLElement): void {
		const content = this.createSection(containerEl, 'Vault Sync', true);

		// Sync info
		this.renderSyncInfo(content);

		// Action buttons
		new Setting(content)
			.addButton(button =>
				button
					.setButtonText('Sync Now')
					.setCta()
					.onClick(async () => {
						button.setButtonText('Syncing...');
						button.setDisabled(true);
						this.refreshSyncInfo();
						try {
							await this.plugin.triggerSync();
						} finally {
							button.setButtonText('Sync Now');
							button.setDisabled(false);
							this.refreshSyncInfo();
						}
					})
			)
			.addButton(button =>
				button
					.setButtonText('View Conflict Log')
					.onClick(async () => {
						const file = this.plugin.app.vault.getAbstractFileByPath(
							'.lumen-conflicts.md',
						);
						if (file) {
							await this.plugin.app.workspace.openLinkText(
								'.lumen-conflicts.md',
								'',
							);
						} else {
							new Notice(
								'No conflict log found. No conflicts have been detected yet.',
							);
						}
					})
			);

		// Activity log
		this.renderActivityLog(content);
	}

	// -----------------------------------------------------------------------
	// Advanced Section
	// -----------------------------------------------------------------------

	private renderAdvancedSection(containerEl: HTMLElement): void {
		const content = this.createSection(containerEl, 'Advanced', false);

		// Workspace ID (readonly)
		new Setting(content)
			.setName('Workspace ID')
			.setDesc('The workspace this vault syncs to (set during registration)')
			.addText(text => {
				text
					.setValue(this.plugin.settings.workspaceId || 'Not configured')
					.setDisabled(true);
				text.inputEl.style.fontFamily = 'var(--font-monospace)';
				text.inputEl.style.fontSize = 'var(--font-ui-smaller)';
			});

		// Device ID (readonly, with reset button)
		new Setting(content)
			.setName('Device ID')
			.setDesc('Unique identifier for this device. Reset to re-register with the server.')
			.addText(text => {
				text
					.setValue(this.plugin.settings.deviceId || 'Not configured')
					.setDisabled(true);
				text.inputEl.style.fontFamily = 'var(--font-monospace)';
				text.inputEl.style.fontSize = 'var(--font-ui-smaller)';
			})
			.addButton(button => {
				button
					.setButtonText('Reset')
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.deviceId = '';
						this.plugin.settings.workspaceId = '';
						this.plugin.settings.lastSyncCursor = '';
						await this.plugin.saveSettings();
						this.display();
						new Notice('Device reset. Workspace ID will be re-resolved from API key on next load.');
					});
			});

		// Debug mode
		new Setting(content)
			.setName('Debug mode')
			.setDesc('Enable verbose logging to the developer console')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.debugMode)
					.onChange(async (value) => {
						this.plugin.settings.debugMode = value;
						await this.plugin.saveSettings();
					})
			);
	}

	// -----------------------------------------------------------------------
	// Connection Status Display
	// -----------------------------------------------------------------------

	private renderConnectionStatus(): void {
		if (!this._connectionStatusEl) return;
		this._connectionStatusEl.empty();

		if (this._lastConnectionResult) {
			this._connectionStatusEl.createEl('div', {
				text: this._lastConnectionResult.message,
				cls: `lumen-status-${this._lastConnectionResult.type}`,
			});
		} else if (this.plugin.settings.apiKey) {
			this._connectionStatusEl.createEl('div', {
				text: 'Not connected \u2014 click Test Connection to verify',
				cls: 'lumen-status-info',
			});
		}
	}

	private clearConnectionStatus(): void {
		this._connectionStatusEl?.empty();
	}

	private showConnectionStatus(type: 'success' | 'error' | 'info', message: string): void {
		this._lastConnectionResult = { type, message };
		if (!this._connectionStatusEl) return;
		this._connectionStatusEl.empty();
		this._connectionStatusEl.createEl('div', {
			text: message,
			cls: `lumen-status-${type}`,
		});
	}

	// -----------------------------------------------------------------------
	// Sync Info Display
	// -----------------------------------------------------------------------

	private renderSyncInfo(containerEl: HTMLElement): void {
		const infoEl = containerEl.createEl('div', { cls: 'lumen-sync-info' });

		// Last sync
		const lastSync = this.plugin.settings.lastSyncAt;
		const lastSyncRow = infoEl.createEl('div', { cls: 'lumen-sync-info-row' });
		lastSyncRow.createEl('span', {
			text: 'Last sync:',
			cls: 'lumen-sync-info-label',
		});
		this._lastSyncValueEl = lastSyncRow.createEl('span', {
			text: lastSync ? formatRelativeTime(lastSync) : 'Never',
			cls: 'lumen-sync-info-value',
		});

		// Current sync state (if not idle)
		const state = this.plugin.syncManager?.getState();
		const stateRow = infoEl.createEl('div', { cls: 'lumen-sync-info-row' });
		stateRow.createEl('span', {
			text: 'Status:',
			cls: 'lumen-sync-info-label',
		});
		this._syncStateValueEl = stateRow.createEl('span', {
			text: state && state !== 'idle'
				? state.charAt(0).toUpperCase() + state.slice(1)
				: 'Idle',
			cls: 'lumen-sync-info-value',
		});
	}

	/** Refresh the sync info labels without re-rendering the whole tab. */
	private refreshSyncInfo(): void {
		if (this._lastSyncValueEl) {
			const lastSync = this.plugin.settings.lastSyncAt;
			this._lastSyncValueEl.textContent = lastSync
				? formatRelativeTime(lastSync)
				: 'Never';
		}
		if (this._syncStateValueEl) {
			const state = this.plugin.syncManager?.getState();
			this._syncStateValueEl.textContent = state && state !== 'idle'
				? state.charAt(0).toUpperCase() + state.slice(1)
				: 'Idle';
		}
	}

	// -----------------------------------------------------------------------
	// Activity Log (inline in settings)
	// -----------------------------------------------------------------------

	hide(): void {
		if (this._activityLogListener) {
			logger.removeListener(this._activityLogListener);
			this._activityLogListener = null;
		}
	}

	private renderActivityLog(containerEl: HTMLElement): void {
		const wrapper = containerEl.createEl('div', { cls: 'lumen-activity-log' });
		const header = wrapper.createEl('div', { cls: 'lumen-activity-log-header' });
		const titleEl = header.createEl('span', { cls: 'lumen-activity-log-title' });
		const titleIcon = titleEl.createEl('span', { cls: 'lumen-activity-log-title-icon' });
		setIcon(titleIcon, 'scroll-text');
		titleEl.createEl('span', { text: 'Recent Activity' });

		const actions = header.createEl('div', { cls: 'lumen-activity-log-actions' });

		const copyLogBtn = actions.createEl('button', {
			cls: 'lumen-activity-btn',
			attr: { 'aria-label': 'Copy log to clipboard' },
		});
		const copyIcon = copyLogBtn.createEl('span', { cls: 'lumen-activity-btn-icon' });
		setIcon(copyIcon, 'copy');
		copyLogBtn.createEl('span', { text: 'Copy' });
		copyLogBtn.addEventListener('click', () => {
			const entries = logger.getEntries().filter(e => e.level !== 'debug');
			const text = entries
				.map(e => {
					const t = new Date(e.timestamp).toLocaleTimeString();
					return `${t} [${e.level.toUpperCase()}] ${e.message}`;
				})
				.join('\n');
			navigator.clipboard.writeText(text).then(
				() => {
					new Notice('Activity log copied to clipboard');
					copyLogBtn.classList.add('lumen-activity-btn-success');
					setTimeout(() => copyLogBtn.classList.remove('lumen-activity-btn-success'), 1500);
				},
				() => new Notice('Failed to copy log to clipboard'),
			);
		});

		const openFullBtn = actions.createEl('button', {
			cls: 'lumen-activity-btn',
			attr: { 'aria-label': 'Open full debug log' },
		});
		const fullIcon = openFullBtn.createEl('span', { cls: 'lumen-activity-btn-icon' });
		setIcon(fullIcon, 'external-link');
		openFullBtn.createEl('span', { text: 'Full Log' });
		openFullBtn.addEventListener('click', () => {
			this.plugin.activateDebugLogView();
		});

		const logEl = wrapper.createEl('div', { cls: 'lumen-activity-log-entries' });

		// Render recent entries (info/warn/error only)
		const entries = logger.getEntries()
			.filter(e => e.level !== 'debug')
			.slice(-20);

		for (const entry of entries) {
			this.renderLogEntry(logEl, entry);
		}

		// Auto-scroll to bottom
		logEl.scrollTop = logEl.scrollHeight;

		// Live updates
		const listener: LogEntryListener = (entry) => {
			if (entry.level === 'debug') return;
			this.renderLogEntry(logEl, entry);
			logEl.scrollTop = logEl.scrollHeight;
			// Trim to 20 entries
			while (logEl.children.length > 20) {
				logEl.firstChild?.remove();
			}
		};
		logger.onEntry(listener);
		this._activityLogListener = listener;
	}

	private renderLogEntry(container: HTMLElement, entry: { timestamp: string; level: string; message: string }): void {
		const row = container.createEl('div', {
			cls: `lumen-activity-entry lumen-activity-${entry.level}`,
		});
		const time = new Date(entry.timestamp);
		row.createEl('span', {
			text: time.toLocaleTimeString(),
			cls: 'lumen-activity-time',
		});
		row.createEl('span', {
			cls: `lumen-activity-level lumen-activity-level-${entry.level}`,
		});
		row.createEl('span', { text: entry.message, cls: 'lumen-activity-msg' });
	}

	// -----------------------------------------------------------------------
	// Collapsible Section Helper
	// -----------------------------------------------------------------------

	private createSection(
		container: HTMLElement,
		title: string,
		defaultOpen: boolean,
	): HTMLElement {
		const header = container.createEl('div', { cls: 'lumen-section-header' });
		const chevron = header.createEl('span', { cls: 'lumen-section-chevron' });
		setIcon(chevron, 'chevron-right');
		header.createEl('span', { text: title });

		const content = container.createEl('div', { cls: 'lumen-section-content' });

		if (defaultOpen) {
			chevron.classList.add('lumen-section-chevron-open');
		} else {
			content.classList.add('lumen-section-collapsed');
		}

		header.addEventListener('click', () => {
			const isCollapsed = content.classList.toggle('lumen-section-collapsed');
			chevron.classList.toggle('lumen-section-chevron-open', !isCollapsed);
		});

		return content;
	}

	// -----------------------------------------------------------------------
	// Validators
	// -----------------------------------------------------------------------

	private updateKeyValidation(setting: Setting, value: string): void {
		setting.descEl.empty();
		if (!value) {
			setting.setDesc('Your Lumen API key (starts with vr_). Get one from your Lumen dashboard.');
			return;
		}

		if (!value.startsWith('vr_')) {
			setting.setDesc('API keys should start with "vr_". Make sure you copied the full key.');
		} else if (value.length < 10) {
			setting.setDesc('This key looks too short. Make sure you copied the full key.');
		} else {
			setting.setDesc('Your Lumen API key (starts with vr_). Get one from your Lumen dashboard.');
		}
	}

	/** Format connection errors into user-friendly messages */
	private formatConnectionError(err: unknown): string {
		if (!(err instanceof Error)) {
			return 'An unexpected error occurred. Please check your settings.';
		}

		const msg = err.message;

		// Network / DNS errors
		if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
			return 'Server not found. Lumen may be temporarily unavailable.';
		}
		if (msg.includes('ECONNREFUSED')) {
			return 'Connection refused. Lumen may be temporarily unavailable.';
		}
		if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
			return 'Connection timed out. Lumen may be temporarily unavailable.';
		}
		if (msg.includes('CERT') || msg.includes('certificate')) {
			return 'SSL certificate error. Please try again later.';
		}

		// Auth errors
		if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('Authentication')) {
			return 'Invalid API key. Check that the key is correct and active.';
		}
		if (msg.includes('403') || msg.includes('Forbidden')) {
			return 'Access denied. Your API key may not have sufficient permissions.';
		}

		// Server errors
		if (msg.includes('404')) {
			return 'Endpoint not found. Lumen may be updating. Please try again later.';
		}
		if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
			return 'Server error. Lumen may be starting up or experiencing issues.';
		}

		return msg;
	}
}
