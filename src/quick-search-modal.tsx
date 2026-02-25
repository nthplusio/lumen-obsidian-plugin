/**
 * Quick Search Modal — Floating search with instant results.
 *
 * Cmd/Ctrl+Shift+L opens a modal with:
 *   - Instant search-as-you-type
 *   - Arrow key navigation through results
 *   - Enter to open, Escape to close
 *   - Minimal UI focused on speed
 */

import { Modal } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import type LumenPlugin from './main';
import { QuickSearchContent } from './ui/components/search/QuickSearchContent';

export class QuickSearchModal extends Modal {
	private plugin: LumenPlugin;
	private reactRoot: Root | null = null;

	constructor(plugin: LumenPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		contentEl.addClass('lumen-quick-search-content');
		modalEl.addClass('lumen-quick-search-modal');

		this.reactRoot = createRoot(contentEl);
		this.reactRoot.render(
			<QuickSearchContent
				plugin={this.plugin}
				app={this.app}
				onClose={() => this.close()}
			/>,
		);
	}

	onClose(): void {
		this.reactRoot?.unmount();
		this.reactRoot = null;
		this.contentEl.empty();
	}
}
