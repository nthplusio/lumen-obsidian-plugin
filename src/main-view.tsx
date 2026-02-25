/**
 * Main Sidebar View for Lumen (React).
 *
 * Thin ItemView wrapper that creates a React root on open and unmounts
 * on close. All UI logic lives in the React component tree.
 *
 * Stores a ref to LumenApp for imperative command access
 * (focus search, switch tabs, new chat).
 */

import { ItemView, WorkspaceLeaf } from 'obsidian';
import { createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type LumenPlugin from './main';
import { LumenApp, type LumenAppHandle } from './ui/LumenApp';

export const VIEW_TYPE_LUMEN_MAIN = 'lumen-main-view';

export class LumenMainView extends ItemView {
	private plugin: LumenPlugin;
	private reactRoot: Root | null = null;
	appRef = createRef<LumenAppHandle>();

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
				ref={this.appRef}
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
