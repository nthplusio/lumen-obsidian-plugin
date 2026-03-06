/**
 * WorkspaceConfirmationModal — Confirmation modal shown when registering
 * a plugin device against a workspace that already has content.
 *
 * The user must type the workspace name exactly to confirm they intend
 * to sync with this workspace. Returns the typed name or null if cancelled.
 */

import { Modal, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import type { WorkspaceConfirmationDetails } from '../types';

export class WorkspaceConfirmationModal extends Modal {
	private details: WorkspaceConfirmationDetails;
	private resolvePromise: ((value: string | null) => void) | null = null;

	constructor(app: App, details: WorkspaceConfirmationDetails) {
		super(app);
		this.details = details;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('lumen-workspace-confirm-modal');

		// Header
		const header = contentEl.createDiv({ cls: 'lumen-workspace-confirm-header' });
		const titleRow = header.createDiv({ cls: 'lumen-workspace-confirm-title-row' });
		const iconEl = titleRow.createSpan({ cls: 'lumen-workspace-confirm-icon' });
		setIcon(iconEl, 'alert-triangle');
		titleRow.createEl('h2', { text: 'Confirm Workspace' });

		// Description
		const desc = contentEl.createDiv({ cls: 'lumen-workspace-confirm-description' });

		const sources = this.details.existingSources.length > 0
			? this.details.existingSources.join(', ')
			: 'unknown';

		desc.createEl('p', {
			text: `The workspace "${this.details.workspaceName}" already has content:`,
		});

		const detailsList = desc.createEl('ul');
		detailsList.createEl('li', {
			text: `${this.details.existingFileCount} existing file(s)`,
		});
		detailsList.createEl('li', {
			text: `${this.details.existingDeviceCount} connected device(s)`,
		});
		detailsList.createEl('li', {
			text: `Sources: ${sources}`,
		});

		desc.createEl('p', {
			text: 'Type the workspace name below to confirm you want to sync with this workspace.',
		});

		// Input
		const inputContainer = contentEl.createDiv({ cls: 'lumen-workspace-confirm-input-container' });
		const input = inputContainer.createEl('input', {
			type: 'text',
			placeholder: this.details.workspaceName,
			cls: 'lumen-workspace-confirm-input',
		});

		// Footer with buttons
		const footer = contentEl.createDiv({ cls: 'lumen-workspace-confirm-footer' });

		const cancelBtn = footer.createEl('button', {
			text: 'Cancel',
			cls: 'lumen-workspace-confirm-btn',
		});

		const confirmBtn = footer.createEl('button', {
			text: 'Confirm',
			cls: 'lumen-workspace-confirm-btn lumen-workspace-confirm-btn-primary',
		});
		confirmBtn.disabled = true;

		// Enable confirm only when input matches workspace name
		input.addEventListener('input', () => {
			confirmBtn.disabled = input.value !== this.details.workspaceName;
		});

		confirmBtn.addEventListener('click', () => {
			if (input.value === this.details.workspaceName) {
				this.resolve(input.value);
			}
		});

		cancelBtn.addEventListener('click', () => {
			this.resolve(null);
		});

		// Allow Enter key to confirm when input matches
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && input.value === this.details.workspaceName) {
				this.resolve(input.value);
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.resolvePromise) {
			this.resolvePromise(null);
			this.resolvePromise = null;
		}
	}

	/**
	 * Show the modal and wait for user confirmation.
	 * Returns the workspace name if confirmed, or null if cancelled.
	 */
	showAndWait(): Promise<string | null> {
		return new Promise<string | null>((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	private resolve(value: string | null): void {
		if (this.resolvePromise) {
			this.resolvePromise(value);
			this.resolvePromise = null;
		}
		this.close();
	}
}
