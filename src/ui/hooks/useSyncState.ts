/**
 * useSyncState — Subscribe to plugin sync state changes inside React.
 *
 * Reads current values from plugin properties and re-renders only the
 * components that call this hook when sync state changes. This avoids
 * remounting the entire React tree on every sync tick.
 *
 * The snapshot is cached in a ref and only replaced when the underlying
 * values change, because useSyncExternalStore compares snapshots with
 * Object.is — returning a new object every time would infinite-loop.
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';
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
	const cachedSnapshot = useRef<SyncStateValue>({
		syncState: plugin.currentSyncState,
		syncProgress: plugin.currentSyncProgress,
		indexingProgress: plugin.currentIndexingProgress,
	});

	const subscribe = useCallback(
		(onStoreChange: () => void) => plugin.onSyncStateChange(onStoreChange),
		[plugin],
	);

	const getSnapshot = useCallback((): SyncStateValue => {
		const prev = cachedSnapshot.current;
		if (
			prev.syncState === plugin.currentSyncState &&
			prev.syncProgress === plugin.currentSyncProgress &&
			prev.indexingProgress === plugin.currentIndexingProgress
		) {
			return prev;
		}
		const next: SyncStateValue = {
			syncState: plugin.currentSyncState,
			syncProgress: plugin.currentSyncProgress,
			indexingProgress: plugin.currentIndexingProgress,
		};
		cachedSnapshot.current = next;
		return next;
	}, [plugin]);

	return useSyncExternalStore(subscribe, getSnapshot);
}
