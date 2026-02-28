/**
 * ConflictResolutionModal — On-demand modal for resolving sync conflicts.
 *
 * Shows local vs server content side-by-side with actions:
 * Keep Local, Keep Server, or Keep Both.
 *
 * Opened from the ConflictBanner, not during sync.
 */

import { Modal, TFile, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import type { UnresolvedConflict } from '../types';

export type ConflictResolution = 'keep-local' | 'keep-server' | 'keep-both' | 'cancelled';

export class ConflictResolutionModal extends Modal {
	private conflict: UnresolvedConflict;
	private resolvePromise: ((value: ConflictResolution) => void) | null = null;

	constructor(app: App, conflict: UnresolvedConflict) {
		super(app);
		this.conflict = conflict;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('lumen-conflict-modal');

		// Header
		const header = contentEl.createDiv({ cls: 'lumen-conflict-modal-header' });
		const titleRow = header.createDiv({ cls: 'lumen-conflict-modal-title-row' });
		const iconEl = titleRow.createSpan({ cls: 'lumen-conflict-modal-icon' });
		setIcon(iconEl, 'alert-triangle');
		titleRow.createEl('h2', { text: 'Resolve Conflict' });

		const displayPath = this.conflict.path.replace(/^\/+/, '');
		header.createEl('p', {
			text: displayPath,
			cls: 'lumen-conflict-modal-path',
		});

		// Read file contents
		const [localContent, serverContent] = await Promise.all([
			this.readFile(this.conflict.conflictPath),
			this.readFile(this.conflict.path),
		]);

		// Two-panel content area
		const panels = contentEl.createDiv({ cls: 'lumen-conflict-modal-panels' });

		// Local panel (from .conflict copy)
		const localPanel = panels.createDiv({ cls: 'lumen-conflict-modal-panel lumen-conflict-modal-panel-local' });
		localPanel.createDiv({ cls: 'lumen-conflict-modal-panel-header', text: 'Local version' });
		const localBody = localPanel.createDiv({ cls: 'lumen-conflict-modal-panel-content' });
		localBody.createEl('pre', { text: localContent ?? '(file not found)' });

		// Server panel (current main file)
		const serverPanel = panels.createDiv({ cls: 'lumen-conflict-modal-panel lumen-conflict-modal-panel-server' });
		serverPanel.createDiv({ cls: 'lumen-conflict-modal-panel-header', text: 'Server version' });
		const serverBody = serverPanel.createDiv({ cls: 'lumen-conflict-modal-panel-content' });
		serverBody.createEl('pre', { text: serverContent ?? '(file not found)' });

		// Footer with action buttons
		const footer = contentEl.createDiv({ cls: 'lumen-conflict-modal-footer' });

		const keepLocalBtn = footer.createEl('button', {
			text: 'Keep Local',
			cls: 'lumen-conflict-modal-btn lumen-conflict-modal-btn-local',
		});
		keepLocalBtn.addEventListener('click', () => {
			this.resolve('keep-local');
		});

		const keepServerBtn = footer.createEl('button', {
			text: 'Keep Server',
			cls: 'lumen-conflict-modal-btn lumen-conflict-modal-btn-server',
		});
		keepServerBtn.addEventListener('click', () => {
			this.resolve('keep-server');
		});

		const keepBothBtn = footer.createEl('button', {
			text: 'Keep Both',
			cls: 'lumen-conflict-modal-btn lumen-conflict-modal-btn-both',
		});
		keepBothBtn.addEventListener('click', () => {
			this.resolve('keep-both');
		});
	}

	onClose(): void {
		this.contentEl.empty();
		// If modal was closed without choosing, treat as cancelled
		if (this.resolvePromise) {
			this.resolvePromise('cancelled');
			this.resolvePromise = null;
		}
	}

	/**
	 * Show the modal and wait for the user's resolution choice.
	 */
	showAndWait(): Promise<ConflictResolution> {
		return new Promise<ConflictResolution>((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	private resolve(resolution: ConflictResolution): void {
		if (this.resolvePromise) {
			this.resolvePromise(resolution);
			this.resolvePromise = null;
		}
		this.close();
	}

	private async readFile(path: string): Promise<string | null> {
		try {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				return await this.app.vault.read(file);
			}
		} catch {
			// File may not exist
		}
		return null;
	}
}
