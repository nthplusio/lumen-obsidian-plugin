/**
 * usePlanState — Subscribe to plugin plan state changes inside React.
 *
 * Reads current values from plugin properties and re-renders only the
 * components that call this hook when plan state changes. This avoids
 * remounting the entire React tree when plan info is fetched.
 */

import { useEffect, useState } from 'react';
import { usePlugin } from '../contexts/PluginContext';
import type { PlanTier } from '../../types';

export interface PlanStateValue {
	planTier: PlanTier;
	planLoaded: boolean;
	planFetchFailed: boolean;
}

export function usePlanState(): PlanStateValue {
	const { plugin } = usePlugin();
	const [state, setState] = useState<PlanStateValue>(() => ({
		planTier: plugin.currentPlanTier,
		planLoaded: plugin.planLoaded,
		planFetchFailed: plugin.planFetchFailed,
	}));

	useEffect(() => {
		return plugin.onPlanChange(() => {
			setState({
				planTier: plugin.currentPlanTier,
				planLoaded: plugin.planLoaded,
				planFetchFailed: plugin.planFetchFailed,
			});
		});
	}, [plugin]);

	return state;
}
