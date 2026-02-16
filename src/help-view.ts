/**
 * In-app Help / Documentation view for the Lumen plugin.
 *
 * Provides a collapsible, scrollable reference covering setup,
 * semantic search, vault sync, configuration, troubleshooting,
 * keyboard shortcuts, and privacy.  Reuses the .lumen-section-*
 * CSS pattern established in SettingsTab (Week 3).
 */

import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type LumenPlugin from './main';

export const VIEW_TYPE_LUMEN_HELP = 'lumen-help';

export class LumenHelpView extends ItemView {
	private plugin: LumenPlugin;
	private sectionMap: Map<string, HTMLElement> = new Map();

	constructor(leaf: WorkspaceLeaf, plugin: LumenPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_LUMEN_HELP;
	}

	getDisplayText(): string {
		return 'Lumen Help';
	}

	getIcon(): string {
		return 'lumen-logo';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		if (!container) return;
		container.empty();
		container.addClass('lumen-help-container');

		// Header
		const header = container.createDiv({ cls: 'lumen-help-header' });
		const titleRow = header.createDiv({ cls: 'lumen-help-title-row' });
		const iconEl = titleRow.createSpan({ cls: 'lumen-help-title-icon' });
		setIcon(iconEl, 'help-circle');
		titleRow.createEl('h2', { text: 'Lumen Help' });

		header.createEl('p', {
			text: 'Everything you need to know about using Lumen with Obsidian.',
			cls: 'lumen-help-subtitle',
		});

		// Scrollable body
		const body = container.createDiv({ cls: 'lumen-help-body' });

		// Table of contents
		this.renderTableOfContents(body);

		// Sections
		this.renderGettingStarted(body);
		this.renderSemanticSearch(body);
		this.renderVaultSync(body);
		this.renderConfiguration(body);
		this.renderTroubleshooting(body);
		this.renderKeyboardShortcuts(body);
		this.renderPrivacySecurity(body);
	}

	async onClose(): Promise<void> {
		this.sectionMap.clear();
	}

	// -----------------------------------------------------------------------
	// Table of Contents
	// -----------------------------------------------------------------------

	private renderTableOfContents(container: HTMLElement): void {
		const toc = container.createDiv({ cls: 'lumen-help-toc' });
		toc.createEl('h3', { text: 'Contents' });

		const list = toc.createEl('ul', { cls: 'lumen-help-toc-list' });

		const sections: [string, string][] = [
			['getting-started', 'Getting Started'],
			['semantic-search', 'Semantic Search'],
			['vault-sync', 'Vault Sync'],
			['configuration', 'Configuration'],
			['troubleshooting', 'Troubleshooting'],
			['keyboard-shortcuts', 'Keyboard Shortcuts'],
			['privacy-security', 'Privacy & Security'],
		];

		for (const [id, label] of sections) {
			const li = list.createEl('li');
			const link = li.createEl('a', {
				text: label,
				cls: 'lumen-help-toc-link',
			});
			link.addEventListener('click', (e) => {
				e.preventDefault();
				this.scrollToSection(id);
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
	// Collapsible Section Helper (mirrors SettingsTab pattern)
	// -----------------------------------------------------------------------

	private createSection(
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

		// Store reference for TOC scroll-to
		this.sectionMap.set(id, wrapper);

		return content;
	}

	// -----------------------------------------------------------------------
	// Section: Getting Started
	// -----------------------------------------------------------------------

	private renderGettingStarted(container: HTMLElement): void {
		const content = this.createSection(container, 'getting-started', 'Getting Started', 'rocket', true);

		this.addParagraph(content, 'Lumen brings AI-powered semantic search to your Obsidian vault. Instead of keyword matching, Lumen understands the meaning of your notes and finds relevant content even when exact words don\'t match.');

		this.addSubheading(content, 'Initial Setup');
		const steps = content.createEl('ol', { cls: 'lumen-help-list' });
		this.addListItem(steps, 'Obtain your API endpoint URL and API key from your Lumen server administrator.');
		this.addListItem(steps, 'Open Settings \u2192 Lumen and enter your API URL and API key.');
		this.addListItem(steps, 'Click "Test Connection" to verify the plugin can reach your server.');
		this.addListItem(steps, 'Enable Vault Sync to keep your notes indexed for search.');
		this.addListItem(steps, 'Use the search sidebar or Ctrl/Cmd+P \u2192 "Lumen: Search" to start searching.');

		this.addTip(content, 'Your Workspace ID will be assigned automatically when you register with the server.');
	}

	// -----------------------------------------------------------------------
	// Section: Semantic Search
	// -----------------------------------------------------------------------

	private renderSemanticSearch(container: HTMLElement): void {
		const content = this.createSection(container, 'semantic-search', 'Semantic Search', 'search', false);

		this.addParagraph(content, 'Semantic search finds notes by meaning rather than exact keywords. Ask natural language questions like "notes about project planning" or "ideas I had about machine learning" and Lumen will find the most relevant content.');

		this.addSubheading(content, 'How to Search');
		const list = content.createEl('ul', { cls: 'lumen-help-list' });
		this.addListItem(list, 'Click the search icon in the left ribbon, or use the command palette.');
		this.addListItem(list, 'Type your query in natural language \u2014 full sentences work best.');
		this.addListItem(list, 'Results appear in real-time as you type (with a short debounce delay).');
		this.addListItem(list, 'Click any result to open the note in your editor.');

		this.addSubheading(content, 'Understanding Scores');
		const scoreTable = content.createDiv({ cls: 'lumen-help-score-table' });

		this.addScoreRow(scoreTable, 'High (80\u2013100%)', 'Strong semantic match. Very relevant to your query.', 'lumen-help-score-high');
		this.addScoreRow(scoreTable, 'Medium (50\u201379%)', 'Partial relevance. Related topics or tangential mentions.', 'lumen-help-score-medium');
		this.addScoreRow(scoreTable, 'Low (below 50%)', 'Weak match. May contain loosely related concepts.', 'lumen-help-score-low');

		this.addSubheading(content, 'Query Tips');
		const tips = content.createEl('ul', { cls: 'lumen-help-list' });
		this.addListItem(tips, 'Be specific: "meeting with Sarah about Q3 budget" works better than "meeting".');
		this.addListItem(tips, 'Use natural language, not Boolean operators (no AND/OR/NOT).');
		this.addListItem(tips, 'Try rephrasing if results aren\'t what you expected \u2014 different wording can surface different notes.');
		this.addListItem(tips, 'Queries are matched against note content, headings, and tags.');
	}

	// -----------------------------------------------------------------------
	// Section: Vault Sync
	// -----------------------------------------------------------------------

	private renderVaultSync(container: HTMLElement): void {
		const content = this.createSection(container, 'vault-sync', 'Vault Sync', 'refresh-cw', false);

		this.addParagraph(content, 'Vault Sync sends your Markdown notes to the Lumen server for indexing. Once indexed, notes are searchable via semantic search. Only .md files are synced \u2014 images, PDFs, and other attachments are not included.');

		this.addSubheading(content, 'How Sync Works');
		const steps = content.createEl('ol', { cls: 'lumen-help-list' });
		this.addListItem(steps, 'The plugin computes a fingerprint (SHA-256 hash) of each Markdown file.');
		this.addListItem(steps, 'It sends a manifest of file paths and hashes to the server.');
		this.addListItem(steps, 'The server compares against its records and requests only changed files.');
		this.addListItem(steps, 'Changed files are uploaded and the server triggers re-indexing.');

		this.addSubheading(content, 'Auto Sync vs Manual Sync');
		const list = content.createEl('ul', { cls: 'lumen-help-list' });
		this.addListItem(list, 'Auto sync runs on a configurable interval (default: every 5 minutes).');
		this.addListItem(list, 'Manual sync can be triggered with the "Sync Now" button in settings or via the command palette.');
		this.addListItem(list, 'The status bar shows current sync state and last sync time.');

		this.addSubheading(content, 'Exclude Patterns');
		this.addParagraph(content, 'Files matching exclude patterns are skipped during sync. By default, .obsidian/ and .trash/ are excluded. You can add custom patterns in Settings \u2192 Lumen \u2192 Vault Sync.');

		this.addSubheading(content, 'Conflicts');
		this.addParagraph(content, 'If the same file is modified on multiple devices between syncs, the most recent version wins (last-write-wins). All conflicts are logged to .lumen-conflicts.md in your vault root for transparency. No data is silently overwritten without a record.');
	}

	// -----------------------------------------------------------------------
	// Section: Configuration
	// -----------------------------------------------------------------------

	private renderConfiguration(container: HTMLElement): void {
		const content = this.createSection(container, 'configuration', 'Configuration', 'settings', false);

		this.addParagraph(content, 'All settings are in Settings \u2192 Lumen. Here\'s what each option does:');

		const settings = [
			['API Endpoint URL', 'The base URL of your Lumen server (e.g., https://app.getlumen.io). Must be HTTPS for non-localhost connections.'],
			['API Key', 'Your authentication key (starts with vr_). Stored locally in the plugin\'s data.json file.'],
			['Enable automatic sync', 'When on, the plugin syncs vault changes on a timer. When off, use manual "Sync Now".'],
			['Auto-sync interval', 'How often auto-sync runs: 1, 2, 5, 10, 15, 30, or 60 minutes. "Manual only" disables the timer.'],
			['Exclude patterns', 'Glob patterns for files/folders to skip during sync. One pattern per line (e.g., templates/, daily/).'],
			['Workspace ID', 'Read-only. Assigned by the server when you register. Identifies which workspace your vault syncs to.'],
			['Device ID', 'Read-only. A unique identifier for this device, generated on first setup.'],
			['Debug mode', 'Enables verbose logging to the developer console (Ctrl/Cmd+Shift+I). Useful for troubleshooting.'],
		];

		const table = content.createEl('div', { cls: 'lumen-help-settings-table' });
		for (const [name, desc] of settings) {
			const row = table.createDiv({ cls: 'lumen-help-setting-row' });
			row.createEl('strong', { text: name });
			row.createEl('span', { text: desc });
		}
	}

	// -----------------------------------------------------------------------
	// Section: Troubleshooting
	// -----------------------------------------------------------------------

	private renderTroubleshooting(container: HTMLElement): void {
		const content = this.createSection(container, 'troubleshooting', 'Troubleshooting', 'wrench', false);

		this.addParagraph(content, 'Common issues and how to resolve them:');

		const issues = [
			[
				'Connection refused',
				'The Lumen server is not running or the URL is incorrect.',
				'Verify the API URL in settings. Check that the server is running and accessible from your network.',
			],
			[
				'Authentication failed (401)',
				'Your API key is invalid, expired, or has been revoked.',
				'Generate a new API key from your server\'s admin panel and update it in Settings \u2192 Lumen.',
			],
			[
				'Access denied (403)',
				'Your API key does not have permission for this workspace.',
				'Contact your server administrator to check workspace membership and key permissions.',
			],
			[
				'Sync timeout',
				'Large uploads may time out on slow connections.',
				'Try syncing with fewer files (add exclude patterns), or check your network connection. The plugin will retry automatically.',
			],
			[
				'MCP endpoint not found (404)',
				'The server URL may be wrong or the server version is outdated.',
				'Verify the URL points to a Lumen server. The endpoint should be at /api/mcp.',
			],
			[
				'Server error (500/502/503)',
				'The server is experiencing issues or restarting.',
				'Wait a moment and retry. If the problem persists, check the server logs or contact your administrator.',
			],
			[
				'No search results',
				'Your vault may not be indexed yet, or the query didn\'t match any content.',
				'Ensure sync has completed at least once. Try broader or rephrased queries. Check that the files you expect are not excluded.',
			],
			[
				'Sync shows 0 files',
				'All files may already be up to date, or all files match exclude patterns.',
				'Check your exclude patterns in settings. If this is a first sync, verify you have .md files in your vault.',
			],
		];

		for (const [title, cause, fix] of issues) {
			const issue = content.createDiv({ cls: 'lumen-help-issue' });
			issue.createEl('div', { text: title, cls: 'lumen-help-issue-title' });
			issue.createEl('div', { text: `Cause: ${cause}`, cls: 'lumen-help-issue-cause' });
			issue.createEl('div', { text: `Fix: ${fix}`, cls: 'lumen-help-issue-fix' });
		}
	}

	// -----------------------------------------------------------------------
	// Section: Keyboard Shortcuts
	// -----------------------------------------------------------------------

	private renderKeyboardShortcuts(container: HTMLElement): void {
		const content = this.createSection(container, 'keyboard-shortcuts', 'Keyboard Shortcuts', 'keyboard', false);

		this.addParagraph(content, 'All Lumen commands are available via the command palette (Ctrl/Cmd+P):');

		const shortcuts = [
			['Lumen: Search vault with Lumen', 'Opens the semantic search sidebar.'],
			['Lumen: Sync vault with Lumen', 'Triggers an immediate manual sync.'],
			['Lumen: Open Help', 'Opens this help panel.'],
		];

		const table = content.createEl('div', { cls: 'lumen-help-shortcuts-table' });
		for (const [command, desc] of shortcuts) {
			const row = table.createDiv({ cls: 'lumen-help-shortcut-row' });
			row.createEl('code', { text: command, cls: 'lumen-help-command' });
			row.createEl('span', { text: desc });
		}

		this.addTip(content, 'You can assign custom hotkeys to any Lumen command in Settings \u2192 Hotkeys.');
	}

	// -----------------------------------------------------------------------
	// Section: Privacy & Security
	// -----------------------------------------------------------------------

	private renderPrivacySecurity(container: HTMLElement): void {
		const content = this.createSection(container, 'privacy-security', 'Privacy & Security', 'shield', false);

		this.addSubheading(content, 'API Key Storage');
		const warning = content.createDiv({ cls: 'lumen-help-warning' });
		const warningIcon = warning.createSpan({ cls: 'lumen-help-warning-icon' });
		setIcon(warningIcon, 'alert-triangle');
		warning.createEl('span', {
			text: 'Your API key is stored in plaintext in .obsidian/plugins/lumen-search/data.json. Do not share this file or commit it to a public repository.',
		});

		this.addSubheading(content, 'What Data is Sent');
		const sentList = content.createEl('ul', { cls: 'lumen-help-list' });
		this.addListItem(sentList, 'During sync: Markdown file content, file paths, and SHA-256 hashes.');
		this.addListItem(sentList, 'During search: Your search query text.');
		this.addListItem(sentList, 'Metadata: workspace ID, device ID, and plugin version.');

		this.addSubheading(content, 'What is NOT Sent');
		const notSentList = content.createEl('ul', { cls: 'lumen-help-list' });
		this.addListItem(notSentList, 'Non-Markdown files (images, PDFs, attachments) are never uploaded.');
		this.addListItem(notSentList, 'Files matching your exclude patterns are never sent.');
		this.addListItem(notSentList, 'Your Obsidian settings, themes, and other plugin data are never accessed.');

		this.addSubheading(content, 'Data Handling');
		const handlingList = content.createEl('ul', { cls: 'lumen-help-list' });
		this.addListItem(handlingList, 'All communication uses HTTPS (TLS encryption in transit).');
		this.addListItem(handlingList, 'Your data is stored on the Lumen server you configure \u2014 you control the server.');
		this.addListItem(handlingList, 'Embeddings are generated using OpenAI\'s API (your server sends content to OpenAI for indexing).');
	}

	// -----------------------------------------------------------------------
	// Content Helpers
	// -----------------------------------------------------------------------

	private addSubheading(container: HTMLElement, text: string): void {
		container.createEl('h4', { text, cls: 'lumen-help-subheading' });
	}

	private addParagraph(container: HTMLElement, text: string): void {
		container.createEl('p', { text, cls: 'lumen-help-text' });
	}

	private addListItem(list: HTMLElement, text: string): void {
		list.createEl('li', { text });
	}

	private addTip(container: HTMLElement, text: string): void {
		const tip = container.createDiv({ cls: 'lumen-help-tip' });
		const tipIcon = tip.createSpan({ cls: 'lumen-help-tip-icon' });
		setIcon(tipIcon, 'lightbulb');
		tip.createEl('span', { text });
	}

	private addScoreRow(container: HTMLElement, label: string, desc: string, cls: string): void {
		const row = container.createDiv({ cls: 'lumen-help-score-row' });
		row.createEl('span', { text: label, cls });
		row.createEl('span', { text: desc });
	}
}
