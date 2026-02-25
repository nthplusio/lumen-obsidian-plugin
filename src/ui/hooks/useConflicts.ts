/**
 * useConflicts — Subscribes to sync conflict changes from the plugin.
 *
 * Returns the current conflict list and actions to dismiss or open
 * conflicted files.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ConflictEntry } from '../../types';
import { usePlugin } from '../contexts/PluginContext';

export interface UseConflictsReturn {
	conflicts: ConflictEntry[];
	dismiss: () => void;
	openFile: (path: string) => void;
	openConflictLog: () => void;
}

export function useConflicts(): UseConflictsReturn {
	const { plugin, app } = usePlugin();
	const [conflicts, setConflicts] = useState<ConflictEntry[]>(plugin.recentConflicts);

	useEffect(() => {
		const unsub = plugin.onConflictsChange(setConflicts);
		// Sync initial state in case it changed between render and effect
		setConflicts(plugin.recentConflicts);
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

	return { conflicts, dismiss, openFile, openConflictLog };
}
