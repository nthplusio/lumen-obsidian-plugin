/**
 * SyncStatusBar — Status bar widget for vault sync progress.
 *
 * Renders in Obsidian's bottom status bar showing sync state
 * with icon, text, and click-to-retry on errors.
 */

import { setIcon } from 'obsidian';
import type { SyncState } from '../types';
import { networkStatus } from '../utils/network-status';

/** Lucide icon name per sync state */
const STATE_ICONS: Record<SyncState, string> = {
	idle: 'lumen-logo',
	hashing: 'loader-2',
	manifest: 'loader-2',
	uploading: 'loader-2',
	downloading: 'loader-2',
	success: 'check-circle',
	error: 'alert-triangle',
	offline: 'wifi-off',
	cancelled: 'circle-slash',
};

/** CSS modifier class per sync state */
const STATE_CLASSES: Record<SyncState, string> = {
	idle: 'lumen-sync-idle',
	hashing: 'lumen-sync-active',
	manifest: 'lumen-sync-active',
	uploading: 'lumen-sync-active',
	downloading: 'lumen-sync-active',
	success: 'lumen-sync-success',
	error: 'lumen-sync-error',
	offline: 'lumen-sync-offline',
	cancelled: 'lumen-sync-idle',
};

export class SyncStatusBar {
	private containerEl: HTMLElement;
	private iconEl: HTMLElement;
	private textEl: HTMLElement;
	private onRetry: () => void;
	private onCancel: (() => void) | null = null;
	private lastSyncAt: string | null = null;
	private currentState: SyncState = 'idle';
	private lastFilesUploaded = 0;
	private networkUnsubscribe: (() => void) | null = null;

	constructor(statusBarEl: HTMLElement, onRetry: () => void, onCancel?: () => void) {
		this.onRetry = onRetry;
		this.onCancel = onCancel ?? null;

		this.containerEl = statusBarEl.createEl('span', {
			cls: 'lumen-sync-status-bar lumen-sync-idle',
			attr: {
				role: 'status',
				'aria-live': 'polite',
				'aria-label': 'Lumen sync status',
			},
		});

		this.iconEl = this.containerEl.createEl('span', { cls: 'lumen-sync-icon' });
		setIcon(this.iconEl, STATE_ICONS.idle);

		this.textEl = this.containerEl.createEl('span', { cls: 'lumen-sync-text' });
		this.textEl.textContent = 'Lumen';

		this.containerEl.addEventListener('click', this.handleClick);

		// Show offline state when network goes down
		this.networkUnsubscribe = networkStatus.onChange((online) => {
			if (!online) {
				this.update('offline');
			} else if (this.currentState === 'offline') {
				this.update('idle');
			}
		});

		// Initialize to offline if already offline
		if (!networkStatus.online) {
			this.update('offline');
		}
	}

	/** Update display for a new sync state with optional progress. */
	update(
		state: SyncState,
		progress?: { current: number; total: number; message?: string },
	): void {
		this.currentState = state;

		// Update CSS classes
		this.containerEl.className = `lumen-sync-status-bar ${STATE_CLASSES[state]}`;

		// Update icon
		this.iconEl.empty();
		setIcon(this.iconEl, STATE_ICONS[state]);

		// Track uploaded count for success message
		if (state === 'uploading' && progress) {
			this.lastFilesUploaded = progress.total;
		}

		// Update text
		this.textEl.textContent = this.getStateText(state, progress);

		// Update ARIA attributes
		const isBusy = state === 'hashing' || state === 'manifest' || state === 'uploading' || state === 'downloading';
		this.containerEl.setAttribute('aria-busy', String(isBusy));
		this.containerEl.setAttribute('aria-label', `Lumen sync: ${this.textEl.textContent}`);
	}

	/** Set the "last synced at" timestamp shown in idle state. */
	setLastSyncAt(isoTimestamp: string): void {
		this.lastSyncAt = isoTimestamp;
		if (this.currentState === 'idle') {
			this.textEl.textContent = this.getIdleText();
		}
	}

	/** Show indexing progress after a sync triggers reindexing. */
	showIndexingProgress(indexed: number, total: number, percent: number, serverTriggered?: boolean): void {
		const label = serverTriggered ? 'Server reindexing' : 'Indexing';
		this.containerEl.className = 'lumen-sync-status-bar lumen-sync-active';
		this.iconEl.empty();
		setIcon(this.iconEl, 'database');
		this.textEl.textContent = `${label}: ${indexed}/${total} (${Math.round(percent)}%)`;
		this.containerEl.setAttribute('aria-busy', 'true');
		this.containerEl.setAttribute('aria-label', `Lumen: ${this.textEl.textContent}`);
	}

	/** Clean up DOM and event listeners. */
	destroy(): void {
		this.containerEl.removeEventListener('click', this.handleClick);
		this.containerEl.remove();
		this.networkUnsubscribe?.();
		this.networkUnsubscribe = null;
	}

	// -----------------------------------------------------------------------
	// Private
	// -----------------------------------------------------------------------

	private handleClick = (): void => {
		if (this.currentState === 'error') {
			this.onRetry();
		} else if (this.isSyncing() && this.onCancel) {
			this.onCancel();
		}
	};

	/** Whether the status bar is showing an active sync state. */
	private isSyncing(): boolean {
		return this.currentState === 'hashing'
			|| this.currentState === 'manifest'
			|| this.currentState === 'uploading'
			|| this.currentState === 'downloading';
	}

	private getStateText(
		state: SyncState,
		progress?: { current: number; total: number; message?: string },
	): string {
		switch (state) {
			case 'idle':
				return this.getIdleText();
			case 'hashing':
				return progress
					? `Hashing... ${progress.current}/${progress.total}`
					: 'Hashing...';
			case 'manifest':
				return 'Preparing sync...';
			case 'uploading':
				return progress?.message
					? progress.message
					: progress
						? `Uploading ${progress.total} file(s)...`
						: 'Uploading...';
			case 'downloading':
				return progress
					? `Downloading... ${progress.current}/${progress.total}`
					: 'Downloading...';
			case 'success':
				return this.lastFilesUploaded > 0
					? `Synced ${this.lastFilesUploaded} file(s)`
					: 'Up to date';
			case 'error':
				return 'Sync failed (click to retry)';
			case 'offline':
				return 'Offline';
			case 'cancelled':
				return 'Sync cancelled';
		}
	}

	private getIdleText(): string {
		if (!this.lastSyncAt) return 'Lumen';
		return `Last sync: ${formatRelativeTime(this.lastSyncAt)}`;
	}
}

/** Format an ISO timestamp as relative time (e.g., "2 min ago"). */
export function formatRelativeTime(isoTimestamp: string): string {
	const diffMs = Date.now() - new Date(isoTimestamp).getTime();
	if (isNaN(diffMs) || diffMs < 0) return 'just now';

	const seconds = Math.floor(diffMs / 1000);
	if (seconds < 60) return 'just now';

	const minutes = Math.floor(seconds / 60);
	if (minutes === 1) return '1 min ago';
	if (minutes < 60) return `${minutes} min ago`;

	const hours = Math.floor(minutes / 60);
	if (hours === 1) return '1 hour ago';
	if (hours < 24) return `${hours} hours ago`;

	if (hours < 48) return 'yesterday';
	return `${Math.floor(hours / 24)} days ago`;
}
