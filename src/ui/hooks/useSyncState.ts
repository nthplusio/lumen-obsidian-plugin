/**
 * useSyncState — Subscribe to plugin sync state changes inside React.
 *
 * Reads current values from plugin properties and re-renders only the
 * components that call this hook when sync state changes. This avoids
 * remounting the entire React tree on every sync tick.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { usePlugin } from '../contexts/PluginContext';
import type { SyncProgress, IndexingProgress } from '../contexts/PluginContext';
import type { SyncState } from '../../types';

export interface SyncStateValue {
	syncState: SyncState;
	syncProgress: SyncProgress | undefined;
	indexingProgress: IndexingProgress | undefined;
}

export function useSyncState(): SyncStateValue {
	const { plugin } = usePlugin();

	const subscribe = useCallback(
		(onStoreChange: () => void) => plugin.onSyncStateChange(onStoreChange),
		[plugin],
	);

	const getSnapshot = useCallback(
		(): SyncStateValue => ({
			syncState: plugin.currentSyncState,
			syncProgress: plugin.currentSyncProgress,
			indexingProgress: plugin.currentIndexingProgress,
		}),
		[plugin],
	);

	return useSyncExternalStore(subscribe, getSnapshot);
}
