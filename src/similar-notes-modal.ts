/**
 * Similar Notes Modal for Lumen.
 *
 * Shows notes similar to a given document by calling the
 * searchSimilarDocuments API. Renders results with score badges,
 * snippets, and click-to-open navigation.
 */

import { Modal, Notice, setIcon } from 'obsidian';
import type LumenPlugin from './main';
import type { SearchResult } from './types';

export class SimilarNotesModal extends Modal {
	private plugin: LumenPlugin;
	private documentPath: string;
	private resultsContainer: HTMLElement | null = null;

	constructor(plugin: LumenPlugin, documentPath: string) {
		super(plugin.app);
		this.plugin = plugin;
		this.documentPath = documentPath;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('lumen-similar-modal');

		// Header
		const header = contentEl.createDiv({ cls: 'lumen-similar-header' });
		const titleRow = header.createDiv({ cls: 'lumen-similar-title-row' });
		const iconEl = titleRow.createSpan({ cls: 'lumen-similar-title-icon' });
		setIcon(iconEl, 'file-search');
		titleRow.createEl('h2', { text: 'Similar Notes' });

		// Subtitle showing the source document
		const filename = this.documentPath.split('/').pop()?.replace(/\.md$/, '') ?? this.documentPath;
		header.createEl('p', {
			text: `Notes similar to "${filename}"`,
			cls: 'lumen-similar-subtitle',
		});

		// Results area
		this.resultsContainer = contentEl.createDiv({ cls: 'lumen-similar-results' });

		// Show loading state
		this.showLoading();

		// Fetch similar documents
		await this.fetchSimilarNotes();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private showLoading(): void {
		if (!this.resultsContainer) return;
		this.resultsContainer.empty();
		const loadingEl = this.resultsContainer.createDiv({ cls: 'lumen-similar-loading' });
		loadingEl.createSpan({ text: 'Finding similar notes...', cls: 'lumen-searching' });
	}

	private async fetchSimilarNotes(): Promise<void> {
		if (!this.plugin.settings.apiUrl || !this.plugin.settings.apiKey) {
			this.showError('Not configured', 'Set your API URL and key in Settings → Lumen.');
			return;
		}

		try {
			const results = await this.plugin.apiClient.searchSimilarDocuments(
				this.documentPath,
				{ limit: 10 },
			);

			if (!results || results.length === 0) {
				this.showEmpty();
			} else {
				this.renderResults(results);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';

			if (message.includes('404')) {
				this.showError(
					'File not indexed',
					'This file has not been indexed yet. Run a sync to index your vault.',
				);
			} else if (message.includes('401') || message.includes('403')) {
				this.showError(
					'Authentication error',
					'Check your API key in Settings → Lumen.',
				);
			} else {
				this.showError('Search failed', message);
			}
		}
	}

	private renderResults(results: SearchResult[]): void {
		if (!this.resultsContainer) return;
		this.resultsContainer.empty();

		for (const result of results) {
			const resultEl = this.resultsContainer.createDiv({ cls: 'lumen-similar-item' });
			resultEl.addEventListener('click', () => {
				this.openDocument(result.source_path);
				this.close();
			});

			// Title row
			const titleRow = resultEl.createDiv({ cls: 'lumen-similar-item-title-row' });

			const titleLeft = titleRow.createDiv({ cls: 'lumen-similar-item-title-left' });
			const fileIcon = titleLeft.createSpan({ cls: 'lumen-result-file-icon' });
			setIcon(fileIcon, 'file-text');

			const title = result.heading_hierarchy?.[0]
				|| this.filenameFromPath(result.source_path);
			titleLeft.createSpan({ text: title, cls: 'lumen-similar-item-title' });

			// Score badge
			const scorePercent = Math.round(result.score * 100);
			const scoreCls = scorePercent >= 80 ? 'lumen-score-high'
				: scorePercent >= 50 ? 'lumen-score-medium'
				: 'lumen-score-low';
			titleRow.createSpan({
				text: `${scorePercent}%`,
				cls: `lumen-result-score ${scoreCls}`,
			});

			// Path (if different from title)
			const displayPath = result.source_path.replace(/\.md$/, '');
			if (displayPath !== title) {
				resultEl.createDiv({
					text: displayPath,
					cls: 'lumen-similar-item-path',
				});
			}

			// Snippet
			if (result.content) {
				const maxLen = 200;
				let snippet = result.content.replace(/\n{3,}/g, '\n\n').trim();
				if (snippet.length > maxLen) {
					snippet = snippet.slice(0, maxLen) + '...';
				}
				resultEl.createDiv({
					text: snippet,
					cls: 'lumen-similar-item-snippet',
				});
			}

			// Tags
			const tags = result.frontmatter?.tags as string[] | undefined;
			if (tags && tags.length > 0) {
				const tagsEl = resultEl.createDiv({ cls: 'lumen-result-tags' });
				for (const tag of tags.slice(0, 5)) {
					const tagEl = tagsEl.createSpan({ cls: 'lumen-tag' });
					setIcon(tagEl.createSpan({ cls: 'lumen-tag-icon' }), 'hash');
					tagEl.createSpan({ text: tag.replace(/^#/, '') });
				}
			}
		}
	}

	private showEmpty(): void {
		if (!this.resultsContainer) return;
		this.resultsContainer.empty();

		const emptyEl = this.resultsContainer.createDiv({ cls: 'lumen-similar-empty' });
		const iconEl = emptyEl.createDiv({ cls: 'lumen-empty-icon' });
		setIcon(iconEl, 'search-x');
		emptyEl.createEl('p', { text: 'No similar notes found' });
		emptyEl.createEl('p', {
			text: 'This note may not share enough content with other indexed notes.',
			cls: 'lumen-empty-hint',
		});
	}

	private showError(title: string, detail: string): void {
		if (!this.resultsContainer) return;
		this.resultsContainer.empty();

		const errorEl = this.resultsContainer.createDiv({ cls: 'lumen-similar-error' });
		const iconEl = errorEl.createDiv({ cls: 'lumen-error-icon' });
		setIcon(iconEl, 'alert-triangle');
		errorEl.createEl('p', { text: title, cls: 'lumen-error-title' });
		errorEl.createEl('p', { text: detail, cls: 'lumen-error-detail' });
	}

	private async openDocument(documentPath: string): Promise<void> {
		const normalizedPath = documentPath.replace(/^\/+/, '');

		const file = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (file) {
			await this.app.workspace.openLinkText(normalizedPath, '', false);
		} else {
			const withMd = normalizedPath.endsWith('.md') ? normalizedPath : normalizedPath + '.md';
			const withoutMd = normalizedPath.replace(/\.md$/, '');

			const altFile = this.app.vault.getAbstractFileByPath(withMd)
				|| this.app.vault.getAbstractFileByPath(withoutMd);

			if (altFile) {
				await this.app.workspace.openLinkText(altFile.path, '', false);
			} else {
				new Notice(`File not found in vault: ${normalizedPath}`);
			}
		}
	}

	private filenameFromPath(path: string): string {
		return path.split('/').pop()?.replace(/\.md$/, '') ?? path;
	}
}
