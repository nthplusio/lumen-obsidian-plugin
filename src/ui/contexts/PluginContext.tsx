/**
 * PluginContext — Read-only context providing access to the Obsidian plugin,
 * app, view, and Component (for MarkdownRenderer link resolution).
 */

import { createContext, useContext } from 'react';
import type { App, Component, ItemView } from 'obsidian';
import type LumenPlugin from '../../main';

export interface PluginContextValue {
	plugin: LumenPlugin;
	app: App;
	view: ItemView;
	/** Obsidian Component instance for MarkdownRenderer.render() */
	component: Component;
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
