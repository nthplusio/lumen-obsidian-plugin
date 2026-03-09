/**
 * usePlanState — Subscribe to plugin plan state changes inside React.
 *
 * Reads current values from plugin properties and re-renders only the
 * components that call this hook when plan state changes. This avoids
 * remounting the entire React tree when plan info is fetched.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { usePlugin } from '../contexts/PluginContext';
import type { PlanTier } from '../../types';

export interface PlanStateValue {
	planTier: PlanTier;
	planLoaded: boolean;
	planFetchFailed: boolean;
}

export function usePlanState(): PlanStateValue {
	const { plugin } = usePlugin();

	const subscribe = useCallback(
		(onStoreChange: () => void) => plugin.onPlanChange(onStoreChange),
		[plugin],
	);

	const getSnapshot = useCallback(
		(): PlanStateValue => ({
			planTier: plugin.currentPlanTier,
			planLoaded: plugin.planLoaded,
			planFetchFailed: plugin.planFetchFailed,
		}),
		[plugin],
	);

	return useSyncExternalStore(subscribe, getSnapshot);
}
