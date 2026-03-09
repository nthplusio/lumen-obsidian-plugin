/**
 * SyncStatusStrip — In-sidebar sync/indexing status indicator.
 *
 * Shows a compact status strip below the tab bar. On mobile this is
 * the only way to see sync state (the Obsidian status bar is hidden).
 * On desktop it provides a convenient in-context indicator too.
 *
 * Click triggers sync (idle/error) or cancels (active).
 */

import { useCallback, useEffect, useRef } from 'react';
import { setIcon } from 'obsidian';
import { usePlugin } from '../contexts/PluginContext';
import { useSyncState } from '../hooks/useSyncState';
import { STATE_ICONS, STATE_CLASSES } from '../../sync/sync-status-bar';
import type { SyncState } from '../../types';

/** Get display text for a sync state */
function getStateText(
	state: SyncState,
	progress?: { current: number; total: number; message?: string },
): string {
	switch (state) {
		case 'idle':
			return 'Synced';
		case 'hashing':
			return progress
				? `Hashing ${progress.current}/${progress.total}`
				: 'Hashing...';
		case 'manifest':
			return 'Preparing sync...';
		case 'uploading':
			return progress?.message
				? progress.message
				: progress
					? `Uploading ${progress.total} file(s)`
					: 'Uploading...';
		case 'downloading':
			return progress
				? `Downloading ${progress.current}/${progress.total}`
				: 'Downloading...';
		case 'success':
			return 'Up to date';
		case 'error':
			return 'Sync failed — tap to retry';
		case 'offline':
			return 'Offline';
		case 'resolving-conflicts':
			return 'Resolving conflicts...';
		case 'cancelled':
			return 'Sync cancelled';
	}
}

export function SyncStatusStrip() {
	const { plugin } = usePlugin();
	const { syncState, syncProgress, indexingProgress } = useSyncState();
	const iconRef = useRef<HTMLSpanElement>(null);

	const state = syncState;
	const isIndexing = !!indexingProgress;

	// Determine icon and text
	const iconName = isIndexing ? 'database' : STATE_ICONS[state];
	const stateClass = isIndexing ? 'lumen-sync-active' : STATE_CLASSES[state];

	const text = isIndexing
		? `${indexingProgress.serverTriggered ? 'Server reindexing' : 'Indexing'}: ${indexingProgress.indexed}/${indexingProgress.total} (${Math.round(indexingProgress.percent)}%)`
		: getStateText(state, syncProgress);

	// Update icon via Obsidian's setIcon
	useEffect(() => {
		if (iconRef.current) {
			iconRef.current.empty();
			setIcon(iconRef.current, iconName);
		}
	}, [iconName]);

	const isSyncing = state === 'hashing' || state === 'manifest' || state === 'uploading'
		|| state === 'downloading' || state === 'resolving-conflicts';

	const handleClick = useCallback(() => {
		if (state === 'error' || state === 'idle') {
			plugin.requestSync();
		} else if (isSyncing) {
			plugin.requestCancelSync();
		}
	}, [plugin, state, isSyncing]);

	const isClickable = state === 'error' || state === 'idle' || isSyncing;

	return (
		<div
			className={`lumen-sync-strip ${stateClass}`}
			onClick={handleClick}
			role="status"
			aria-live="polite"
			aria-label={`Lumen sync: ${text}`}
			style={{ cursor: isClickable ? 'pointer' : 'default' }}
		>
			<span ref={iconRef} className="lumen-sync-strip-icon" />
			<span className="lumen-sync-strip-text">{text}</span>
		</div>
	);
}
