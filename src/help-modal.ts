/**
 * Help / Documentation modal for the Lumen plugin.
 *
 * Data-driven renderer: iterates HELP_SECTIONS from help-content.ts
 * and renders each ContentBlock type. The content data is maintained
 * separately so the coverage checker can validate it independently.
 */

import { Modal, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import { HELP_SECTIONS, type ContentBlock, type HelpSection } from './help-content';

export class LumenHelpModal extends Modal {
	private sectionMap: Map<string, HTMLElement> = new Map();

	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('lumen-help-modal');

		// Header
		const header = contentEl.createDiv({ cls: 'lumen-help-header' });
		const titleRow = header.createDiv({ cls: 'lumen-help-title-row' });
		const iconEl = titleRow.createSpan({ cls: 'lumen-help-title-icon' });
		setIcon(iconEl, 'help-circle');
		titleRow.createEl('h2', { text: 'Lumen Help' });

		header.createEl('p', {
			text: 'Everything you need to know about using Lumen with Obsidian.',
			cls: 'lumen-help-subtitle',
		});

		// Scrollable body
		const body = contentEl.createDiv({ cls: 'lumen-help-body' });

		// Table of contents (auto-generated from section data)
		this.renderTableOfContents(body);

		// Render all sections from data
		for (const section of HELP_SECTIONS) {
			this.renderSection(body, section);
		}
	}

	onClose(): void {
		this.sectionMap.clear();
		this.contentEl.empty();
	}

	// -----------------------------------------------------------------------
	// Table of Contents
	// -----------------------------------------------------------------------

	private renderTableOfContents(container: HTMLElement): void {
		const toc = container.createDiv({ cls: 'lumen-help-toc' });
		toc.createEl('h3', { text: 'Contents' });

		const list = toc.createEl('ul', { cls: 'lumen-help-toc-list' });

		for (const section of HELP_SECTIONS) {
			const li = list.createEl('li');
			const link = li.createEl('a', {
				text: section.title,
				cls: 'lumen-help-toc-link',
			});
			link.addEventListener('click', (e) => {
				e.preventDefault();
				this.scrollToSection(section.id);
			});
		}
	}

	private scrollToSection(id: string): void {
		const el = this.sectionMap.get(id);
		if (el) {
			el.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	}

	// -----------------------------------------------------------------------
	// Section rendering
	// -----------------------------------------------------------------------

	private renderSection(container: HTMLElement, section: HelpSection): void {
		const content = this.createCollapsible(
			container,
			section.id,
			section.title,
			section.icon,
			section.defaultOpen,
		);

		for (const block of section.content) {
			this.renderBlock(content, block);
		}
	}

	private createCollapsible(
		container: HTMLElement,
		id: string,
		title: string,
		icon: string,
		defaultOpen: boolean,
	): HTMLElement {
		const wrapper = container.createDiv({ cls: 'lumen-help-section' });

		const header = wrapper.createEl('div', { cls: 'lumen-section-header' });
		const chevron = header.createEl('span', { cls: 'lumen-section-chevron' });
		setIcon(chevron, 'chevron-right');

		const headerIcon = header.createEl('span', { cls: 'lumen-help-section-icon' });
		setIcon(headerIcon, icon);
		header.createEl('span', { text: title });

		const content = wrapper.createEl('div', { cls: 'lumen-section-content' });

		if (defaultOpen) {
			chevron.classList.add('lumen-section-chevron-open');
		} else {
			content.classList.add('lumen-section-collapsed');
		}

		header.addEventListener('click', () => {
			const isCollapsed = content.classList.toggle('lumen-section-collapsed');
			chevron.classList.toggle('lumen-section-chevron-open', !isCollapsed);
		});

		this.sectionMap.set(id, wrapper);

		return content;
	}

	// -----------------------------------------------------------------------
	// Block renderers
	// -----------------------------------------------------------------------

	private renderBlock(container: HTMLElement, block: ContentBlock): void {
		switch (block.type) {
			case 'paragraph':
				container.createEl('p', { text: block.text, cls: 'lumen-help-text' });
				break;

			case 'subheading':
				container.createEl('h4', { text: block.text, cls: 'lumen-help-subheading' });
				break;

			case 'ordered-list': {
				const ol = container.createEl('ol', { cls: 'lumen-help-list' });
				for (const item of block.items) {
					ol.createEl('li', { text: item });
				}
				break;
			}

			case 'unordered-list': {
				const ul = container.createEl('ul', { cls: 'lumen-help-list' });
				for (const item of block.items) {
					ul.createEl('li', { text: item });
				}
				break;
			}

			case 'tip': {
				const tip = container.createDiv({ cls: 'lumen-help-tip' });
				const tipIcon = tip.createSpan({ cls: 'lumen-help-tip-icon' });
				setIcon(tipIcon, 'lightbulb');
				tip.createEl('span', { text: block.text });
				break;
			}

			case 'warning': {
				const warning = container.createDiv({ cls: 'lumen-help-warning' });
				const warningIcon = warning.createSpan({ cls: 'lumen-help-warning-icon' });
				setIcon(warningIcon, 'alert-triangle');
				warning.createEl('span', { text: block.text });
				break;
			}

			case 'score-table': {
				const scoreTable = container.createDiv({ cls: 'lumen-help-score-table' });
				for (const row of block.rows) {
					const rowEl = scoreTable.createDiv({ cls: 'lumen-help-score-row' });
					rowEl.createEl('span', { text: row.label, cls: row.cls });
					rowEl.createEl('span', { text: row.description });
				}
				break;
			}

			case 'settings-table': {
				const table = container.createEl('div', { cls: 'lumen-help-settings-table' });
				for (const row of block.rows) {
					const rowEl = table.createDiv({ cls: 'lumen-help-setting-row' });
					rowEl.createEl('strong', { text: row.name });
					rowEl.createEl('span', { text: row.description });
				}
				break;
			}

			case 'shortcuts-table': {
				const table = container.createEl('div', { cls: 'lumen-help-shortcuts-table' });
				for (const row of block.rows) {
					const rowEl = table.createDiv({ cls: 'lumen-help-shortcut-row' });
					rowEl.createEl('code', { text: row.command, cls: 'lumen-help-command' });
					rowEl.createEl('span', { text: row.description });
				}
				break;
			}

			case 'issues-list': {
				for (const issue of block.issues) {
					const issueEl = container.createDiv({ cls: 'lumen-help-issue' });
					issueEl.createEl('div', { text: issue.title, cls: 'lumen-help-issue-title' });
					issueEl.createEl('div', { text: `Cause: ${issue.cause}`, cls: 'lumen-help-issue-cause' });
					issueEl.createEl('div', { text: `Fix: ${issue.fix}`, cls: 'lumen-help-issue-fix' });
				}
				break;
			}

			case 'code-block': {
				const pre = container.createEl('pre', { cls: 'lumen-help-code-block' });
				pre.createEl('code', { text: block.code });
				break;
			}
		}
	}
}
