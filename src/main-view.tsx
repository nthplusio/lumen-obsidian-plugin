/**
 * Main Sidebar View for Lumen (React).
 *
 * Thin ItemView wrapper that creates a React root on open and unmounts
 * on close. All UI logic lives in the React component tree.
 */

import { ItemView, WorkspaceLeaf } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import type LumenPlugin from './main';
import { LumenApp } from './ui/LumenApp';

export const VIEW_TYPE_LUMEN_MAIN = 'lumen-main-view';

export class LumenMainView extends ItemView {
	private plugin: LumenPlugin;
	private reactRoot: Root | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: LumenPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_LUMEN_MAIN;
	}

	getDisplayText(): string {
		return 'Lumen';
	}

	getIcon(): string {
		return 'lumen-search';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		if (!container) return;
		container.empty();
		container.addClass('lumen-main-container');

		this.reactRoot = createRoot(container);
		this.reactRoot.render(
			<LumenApp
				context={{
					plugin: this.plugin,
					app: this.app,
					view: this,
					component: this,
				}}
			/>,
		);
	}

	async onClose(): Promise<void> {
		this.reactRoot?.unmount();
		this.reactRoot = null;
	}
}
