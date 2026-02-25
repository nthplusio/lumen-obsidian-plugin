/**
 * Network connectivity status singleton.
 *
 * Uses `navigator.onLine` + `online`/`offline` window events to track
 * connectivity. Notifies subscribers on state changes.
 *
 * Integration points:
 *   - SyncManager: skip sync when offline, auto-sync when back online
 *   - SyncStatusBar: show "Offline" indicator
 *   - main.ts: call destroy() in onunload()
 */

import { logger } from './logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NetworkCallback = (online: boolean) => void;

// ---------------------------------------------------------------------------
// NetworkStatus
// ---------------------------------------------------------------------------

export class NetworkStatus {
	private listeners = new Set<NetworkCallback>();
	private _online: boolean;
	private onlineHandler: () => void;
	private offlineHandler: () => void;

	constructor() {
		// navigator.onLine may be undefined in some environments (e.g., Node.js)
		// Default to true (assume online) when not explicitly false
		this._online = typeof navigator !== 'undefined' && navigator.onLine !== undefined
			? navigator.onLine
			: true;

		this.onlineHandler = () => this.setOnline(true);
		this.offlineHandler = () => this.setOnline(false);

		if (typeof window !== 'undefined') {
			window.addEventListener('online', this.onlineHandler);
			window.addEventListener('offline', this.offlineHandler);
		}
	}

	/** Current connectivity state */
	get online(): boolean {
		return this._online;
	}

	/**
	 * Subscribe to connectivity changes.
	 * Callback receives `true` when online, `false` when offline.
	 * @returns Unsubscribe function
	 */
	onChange(cb: NetworkCallback): () => void {
		this.listeners.add(cb);
		return () => {
			this.listeners.delete(cb);
		};
	}

	/**
	 * Clean up window event listeners.
	 * Call from plugin onunload().
	 */
	destroy(): void {
		if (typeof window !== 'undefined') {
			window.removeEventListener('online', this.onlineHandler);
			window.removeEventListener('offline', this.offlineHandler);
		}
		this.listeners.clear();
	}

	// -----------------------------------------------------------------------
	// Private
	// -----------------------------------------------------------------------

	private setOnline(value: boolean): void {
		if (this._online === value) return;
		this._online = value;
		logger.info(`Network: ${value ? 'online' : 'offline'}`);
		for (const cb of this.listeners) {
			try {
				cb(value);
			} catch {
				// Never let a listener error break the event loop
			}
		}
	}
}

/** Singleton instance */
export const networkStatus = new NetworkStatus();
