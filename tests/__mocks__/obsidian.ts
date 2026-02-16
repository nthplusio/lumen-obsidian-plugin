/**
 * Minimal Obsidian API mock for unit testing.
 *
 * Only stubs the classes/types imported by plugin source files.
 * Tests should focus on pure functions (hashing, pattern matching,
 * error classification) that don't depend on Obsidian internals.
 */

export class Plugin {
	app = {};
	manifest = {};
	loadData = async () => ({});
	saveData = async () => {};
	addCommand = () => {};
	addRibbonIcon = () => {};
	addSettingTab = () => {};
	registerView = () => {};
}

export class PluginSettingTab {
	app = {};
	plugin = {};
	containerEl = { empty: () => {}, createEl: () => ({}) };
	display() {}
}

export class ItemView {
	containerEl = { empty: () => {}, createEl: () => ({}) };
	getViewType() { return ''; }
	getDisplayText() { return ''; }
}

export class Setting {
	constructor() {}
	setName() { return this; }
	setDesc() { return this; }
	addText() { return this; }
	addToggle() { return this; }
	addDropdown() { return this; }
}

export class Notice {
	constructor(_message: string) {}
}

export class TFile {
	path = '';
	name = '';
	stat = { mtime: 0, size: 0 };
	extension = 'md';
}

export class Vault {
	getFiles() { return []; }
	getAbstractFileByPath() { return null; }
	read = async () => '';
	readBinary = async () => new ArrayBuffer(0);
	cachedRead = async () => '';
}

export function normalizePath(path: string): string {
	return path;
}

export const Platform = {
	isDesktop: true,
	isMobile: false,
	isDesktopApp: true,
	isMobileApp: false,
};

export class Modal {
	app: unknown;
	contentEl = { empty: () => {}, createEl: () => ({}), createDiv: () => ({}), addClass: () => {} };
	constructor(app: unknown) {
		this.app = app;
	}
	open() {}
	close() {}
	onOpen() {}
	onClose() {}
}

export class WorkspaceLeaf {}

export function setIcon(_el: unknown, _iconId: string): void {}

export function requestUrl(_request: unknown): Promise<unknown> {
	return Promise.resolve({ status: 200, json: {}, text: '' });
}

export const MarkdownRenderer = {
	render(_app: unknown, _markdown: string, _el: unknown, _sourcePath: string, _component: unknown): Promise<void> {
		return Promise.resolve();
	},
};
