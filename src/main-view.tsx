/**
 * Main Sidebar View for Lumen (React).
 *
 * Thin ItemView wrapper that creates a React root on open and unmounts
 * on close. All UI logic lives in the React component tree.
 *
 * Stores a ref to LumenApp for imperative command access
 * (focus search, switch tabs, new chat).
 */

import { ItemView, Platform, WorkspaceLeaf } from 'obsidian';
import { createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type LumenPlugin from './main';
import { LumenApp, type LumenAppHandle } from './ui/LumenApp';

export const VIEW_TYPE_LUMEN_MAIN = 'lumen-main-view';

export class LumenMainView extends ItemView {
	private plugin: LumenPlugin;
	private reactRoot: Root | null = null;
	private unsubSyncState: (() => void) | null = null;
	private unsubPlanChange: (() => void) | null = null;
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

		const render = () => {
			this.reactRoot?.render(
				<LumenApp
					ref={this.appRef}
					context={{
						plugin: this.plugin,
						app: this.app,
						view: this,
						component: this,
						isMobile: Platform.isMobile,
						syncState: this.plugin.currentSyncState,
						syncProgress: this.plugin.currentSyncProgress,
						indexingProgress: this.plugin.currentIndexingProgress,
						planTier: this.plugin.currentPlanTier,
						planLoaded: this.plugin.planLoaded,
						planFetchFailed: this.plugin.planFetchFailed,
					}}
				/>,
			);
		};

		render();

		// Re-render when sync state or plan changes
		this.unsubSyncState = this.plugin.onSyncStateChange(() => render());
		this.unsubPlanChange = this.plugin.onPlanChange(() => render());
	}

	async onClose(): Promise<void> {
		this.unsubSyncState?.();
		this.unsubSyncState = null;
		this.unsubPlanChange?.();
		this.unsubPlanChange = null;
		this.reactRoot?.unmount();
		this.reactRoot = null;
	}
}
