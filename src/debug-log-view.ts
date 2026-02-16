/**
 * Debug Log Viewer for the Lumen plugin.
 *
 * Renders a live, scrollable, filterable list of log entries from the
 * singleton logger's ring buffer.  Subscribes to logger.onEntry() for
 * real-time updates and auto-scrolls unless the user has scrolled up
 * to inspect older entries.
 */

import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type LumenPlugin from './main';
import { logger, type LogEntry, type LogEntryListener, type LogLevel } from './utils/logger';

export const VIEW_TYPE_LUMEN_DEBUG_LOG = 'lumen-debug-log';

/** Log levels shown in the filter dropdown, in severity order. */
const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

export class LumenDebugLogView extends ItemView {
	private plugin: LumenPlugin;

	// DOM references
	private logContainer: HTMLElement | null = null;
	private countEl: HTMLElement | null = null;
	private filterLevel: LogLevel = 'debug'; // show all by default

	// Auto-scroll tracking
	private userScrolledUp = false;

	// Listener ref for cleanup
	private listener: LogEntryListener | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: LumenPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_LUMEN_DEBUG_LOG;
	}

	getDisplayText(): string {
		return 'Lumen Debug Log';
	}

	getIcon(): string {
		return 'lumen-logo';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		if (!container) return;
		container.empty();
		container.addClass('lumen-debug-container');

		// Header: title + controls
		const header = container.createDiv({ cls: 'lumen-debug-header' });

		const titleRow = header.createDiv({ cls: 'lumen-debug-title-row' });
		const iconEl = titleRow.createSpan({ cls: 'lumen-debug-title-icon' });
		setIcon(iconEl, 'bug');
		titleRow.createEl('h3', { text: 'Debug Log' });
		this.countEl = titleRow.createSpan({ cls: 'lumen-debug-count' });

		// Controls row
		const controls = header.createDiv({ cls: 'lumen-debug-controls' });

		// Level filter dropdown
		const filterWrapper = controls.createDiv({ cls: 'lumen-debug-filter' });
		const filterLabel = filterWrapper.createEl('label', { text: 'Level:' });
		const select = filterWrapper.createEl('select', { cls: 'lumen-debug-filter-select' });
		filterLabel.htmlFor = select.id = 'lumen-debug-level-filter';

		for (const level of LOG_LEVELS) {
			select.createEl('option', {
				text: level.charAt(0).toUpperCase() + level.slice(1) + '+',
				value: level,
			});
		}

		select.value = this.filterLevel;
		select.addEventListener('change', () => {
			this.filterLevel = select.value as LogLevel;
			this.renderAllEntries();
		});

		// Clear button
		const clearBtn = controls.createEl('button', {
			cls: 'lumen-debug-btn',
			attr: { 'aria-label': 'Clear log' },
		});
		setIcon(clearBtn, 'trash-2');
		clearBtn.createSpan({ text: 'Clear' });
		clearBtn.addEventListener('click', () => {
			logger.clear();
			this.renderAllEntries();
		});

		// Copy-all button
		const copyBtn = controls.createEl('button', {
			cls: 'lumen-debug-btn',
			attr: { 'aria-label': 'Copy log to clipboard' },
		});
		setIcon(copyBtn, 'copy');
		copyBtn.createSpan({ text: 'Copy' });
		copyBtn.addEventListener('click', () => {
			this.copyLogToClipboard();
		});

		// Scrollable log area
		this.logContainer = container.createDiv({ cls: 'lumen-debug-log' });

		// Track scroll position for auto-scroll behavior
		this.logContainer.addEventListener('scroll', () => {
			if (!this.logContainer) return;
			const { scrollTop, scrollHeight, clientHeight } = this.logContainer;
			// User is "scrolled up" if not within 40px of the bottom
			this.userScrolledUp = scrollHeight - scrollTop - clientHeight > 40;
		});

		// Render existing entries
		this.renderAllEntries();

		// Subscribe to new entries
		this.listener = (entry: LogEntry) => {
			this.appendEntry(entry);
		};
		logger.onEntry(this.listener);
	}

	async onClose(): Promise<void> {
		if (this.listener) {
			logger.removeListener(this.listener);
			this.listener = null;
		}
		this.logContainer = null;
		this.countEl = null;
	}

	// -----------------------------------------------------------------------
	// Rendering
	// -----------------------------------------------------------------------

	/** Re-render all entries from the ring buffer (after filter change or clear). */
	private renderAllEntries(): void {
		if (!this.logContainer) return;
		this.logContainer.empty();

		const entries = logger.getEntries();
		let visibleCount = 0;

		for (const entry of entries) {
			if (this.passesFilter(entry.level)) {
				this.renderEntry(this.logContainer, entry);
				visibleCount++;
			}
		}

		this.updateCount(visibleCount, entries.length);

		// Scroll to bottom after full re-render
		this.scrollToBottom();
	}

	/** Append a single new entry (from the live listener). */
	private appendEntry(entry: LogEntry): void {
		if (!this.logContainer) return;

		if (this.passesFilter(entry.level)) {
			this.renderEntry(this.logContainer, entry);

			if (!this.userScrolledUp) {
				this.scrollToBottom();
			}
		}

		// Update count
		const entries = logger.getEntries();
		const visibleCount = entries.filter(e => this.passesFilter(e.level)).length;
		this.updateCount(visibleCount, entries.length);
	}

	/** Render a single log entry row into the container. */
	private renderEntry(container: HTMLElement, entry: LogEntry): void {
		const row = container.createDiv({ cls: `lumen-debug-entry lumen-debug-level-${entry.level}` });

		// Timestamp (HH:MM:SS.mmm)
		const ts = this.formatTimestamp(entry.timestamp);
		row.createSpan({ text: ts, cls: 'lumen-debug-ts' });

		// Level badge
		row.createSpan({
			text: entry.level.toUpperCase(),
			cls: `lumen-debug-badge lumen-debug-badge-${entry.level}`,
		});

		// Message
		row.createSpan({ text: entry.message, cls: 'lumen-debug-msg' });
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	private passesFilter(level: LogLevel): boolean {
		const idx = LOG_LEVELS.indexOf(level);
		const filterIdx = LOG_LEVELS.indexOf(this.filterLevel);
		return idx >= filterIdx;
	}

	private formatTimestamp(iso: string): string {
		const d = new Date(iso);
		const h = String(d.getHours()).padStart(2, '0');
		const m = String(d.getMinutes()).padStart(2, '0');
		const s = String(d.getSeconds()).padStart(2, '0');
		const ms = String(d.getMilliseconds()).padStart(3, '0');
		return `${h}:${m}:${s}.${ms}`;
	}

	private scrollToBottom(): void {
		if (this.logContainer) {
			this.logContainer.scrollTop = this.logContainer.scrollHeight;
		}
	}

	private updateCount(visible: number, total: number): void {
		if (this.countEl) {
			this.countEl.textContent = visible === total
				? `${total} entries`
				: `${visible}/${total} entries`;
		}
	}

	private copyLogToClipboard(): void {
		const entries = logger.getEntries().filter(e => this.passesFilter(e.level));

		const text = entries
			.map(e => `${this.formatTimestamp(e.timestamp)} [${e.level.toUpperCase()}] ${e.message}`)
			.join('\n');

		navigator.clipboard.writeText(text).then(
			() => {
				// Brief visual feedback on the copy button
				if (this.countEl) {
					const prev = this.countEl.textContent;
					this.countEl.textContent = 'Copied!';
					setTimeout(() => {
						if (this.countEl) this.countEl.textContent = prev ?? '';
					}, 1500);
				}
			},
			() => {
				// Clipboard API failed — fallback notice
				if (this.countEl) {
					this.countEl.textContent = 'Copy failed';
				}
			},
		);
	}
}
