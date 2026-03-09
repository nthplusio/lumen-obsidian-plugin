/**
 * usePlanState — Subscribe to plugin plan state changes inside React.
 *
 * Reads current values from plugin properties and re-renders only the
 * components that call this hook when plan state changes. This avoids
 * remounting the entire React tree when plan info is fetched.
 *
 * The snapshot is cached in a ref and only replaced when the underlying
 * values change, because useSyncExternalStore compares snapshots with
 * Object.is — returning a new object every time would infinite-loop.
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { usePlugin } from '../contexts/PluginContext';
import type { PlanTier } from '../../types';

export interface PlanStateValue {
	planTier: PlanTier;
	planLoaded: boolean;
	planFetchFailed: boolean;
}

export function usePlanState(): PlanStateValue {
	const { plugin } = usePlugin();
	const cachedSnapshot = useRef<PlanStateValue>({
		planTier: plugin.currentPlanTier,
		planLoaded: plugin.planLoaded,
		planFetchFailed: plugin.planFetchFailed,
	});

	const subscribe = useCallback(
		(onStoreChange: () => void) => plugin.onPlanChange(onStoreChange),
		[plugin],
	);

	const getSnapshot = useCallback((): PlanStateValue => {
		const prev = cachedSnapshot.current;
		if (
			prev.planTier === plugin.currentPlanTier &&
			prev.planLoaded === plugin.planLoaded &&
			prev.planFetchFailed === plugin.planFetchFailed
		) {
			return prev;
		}
		const next: PlanStateValue = {
			planTier: plugin.currentPlanTier,
			planLoaded: plugin.planLoaded,
			planFetchFailed: plugin.planFetchFailed,
		};
		cachedSnapshot.current = next;
		return next;
	}, [plugin]);

	return useSyncExternalStore(subscribe, getSnapshot);
}
