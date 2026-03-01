/**
 * PluginContext — Read-only context providing access to the Obsidian plugin,
 * app, view, and Component (for MarkdownRenderer link resolution).
 */

import { createContext, useContext } from 'react';
import type { App, Component, ItemView } from 'obsidian';
import type LumenPlugin from '../../main';
import type { SyncState } from '../../types';

export interface SyncProgress {
	current: number;
	total: number;
	message?: string;
}

export interface IndexingProgress {
	indexed: number;
	total: number;
	percent: number;
	serverTriggered?: boolean;
}

export interface PluginContextValue {
	plugin: LumenPlugin;
	app: App;
	view: ItemView;
	/** Obsidian Component instance for MarkdownRenderer.render() */
	component: Component;
	/** Whether running on Obsidian mobile */
	isMobile: boolean;
	/** Current sync state (undefined if sync not initialized) */
	syncState?: SyncState;
	/** Current sync progress (only set during active sync phases) */
	syncProgress?: SyncProgress;
	/** Current indexing progress (only set when indexing is active) */
	indexingProgress?: IndexingProgress;
}

const PluginContext = createContext<PluginContextValue | null>(null);

export function PluginProvider({
	value,
	children,
}: {
	value: PluginContextValue;
	children: React.ReactNode;
}) {
	return (
		<PluginContext.Provider value={value}>{children}</PluginContext.Provider>
	);
}

export function usePlugin(): PluginContextValue {
	const ctx = useContext(PluginContext);
	if (!ctx) {
		throw new Error('usePlugin must be used within a PluginProvider');
	}
	return ctx;
}
