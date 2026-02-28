/**
 * useConflicts — Subscribes to unresolved sync conflicts from the plugin.
 *
 * Returns the current conflict list and actions to resolve, dismiss,
 * or open conflicted files.
 */

import { useCallback, useEffect, useState } from 'react';
import type { UnresolvedConflict } from '../../types';
import type { ConflictResolution } from '../../sync/conflict-resolution-modal';
import { usePlugin } from '../contexts/PluginContext';

export interface UseConflictsReturn {
	conflicts: UnresolvedConflict[];
	dismiss: () => void;
	openFile: (path: string) => void;
	openConflictLog: () => void;
	resolve: (conflict: UnresolvedConflict) => void;
	resolveAll: (resolution: ConflictResolution) => void;
}

export function useConflicts(): UseConflictsReturn {
	const { plugin, app } = usePlugin();
	const [conflicts, setConflicts] = useState<UnresolvedConflict[]>(plugin.unresolvedConflicts);

	useEffect(() => {
		const unsub = plugin.onConflictsChange(setConflicts);
		setConflicts(plugin.unresolvedConflicts);
		return unsub;
	}, [plugin]);

	const dismiss = useCallback(() => {
		plugin.dismissConflicts();
	}, [plugin]);

	const openFile = useCallback((path: string) => {
		const normalizedPath = path.replace(/^\/+/, '');
		app.workspace.openLinkText(normalizedPath, '', false);
	}, [app]);

	const openConflictLog = useCallback(() => {
		app.workspace.openLinkText('.lumen-conflicts.md', '', false);
	}, [app]);

	const resolve = useCallback((conflict: UnresolvedConflict) => {
		plugin.openConflictResolution(conflict);
	}, [plugin]);

	const resolveAll = useCallback((resolution: ConflictResolution) => {
		plugin.resolveAllConflicts(resolution);
	}, [plugin]);

	return { conflicts, dismiss, openFile, openConflictLog, resolve, resolveAll };
}
