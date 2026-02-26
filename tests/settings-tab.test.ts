/**
 * LumenSettingTab unit tests.
 *
 * Tests collapsible sections, settings persistence, connection test,
 * server-managed sync settings (read-only), and validation logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LumenSettingTab } from '../src/settings-tab';
import { DEFAULT_SETTINGS, LUMEN_API_URL } from '../src/types';
import type { LumenSettings } from '../src/types';

// ---------------------------------------------------------------------------
// Shared state accessible from vi.mock factory (hoisted)
// ---------------------------------------------------------------------------

const { settingInstances } = vi.hoisted(() => ({
	settingInstances: [] as any[],
}));

// ---------------------------------------------------------------------------
// Mock obsidian module
// ---------------------------------------------------------------------------

vi.mock('obsidian', () => ({
	PluginSettingTab: class {
		app: any;
		plugin: any;
		containerEl: any;
		constructor(app: any, plugin: any) {
			this.app = app;
			this.plugin = plugin;
		}
	},
	Modal: class {
		app: any;
		contentEl = { empty: vi.fn(), createEl: vi.fn(), createDiv: vi.fn(), addClass: vi.fn() };
		constructor(app: any) { this.app = app; }
		open = vi.fn();
		close = vi.fn();
		onOpen() {}
		onClose() {}
	},
	Setting: class {
		_name = '';
		_desc = '';
		descEl = { empty: vi.fn() };
		_texts: any[] = [];
		_toggles: any[] = [];
		_dropdowns: any[] = [];
		_buttons: any[] = [];

		constructor(_containerEl?: any) {
			settingInstances.push(this);
		}

		setName(n: string) { this._name = n; return this; }
		setDesc(d: string) { this._desc = d; return this; }

		addText(cb: Function) {
			const t: any = {
				inputEl: { type: 'text', autocomplete: '', style: {} },
				_value: '', _placeholder: '', _disabled: false, _onChange: null,
				setPlaceholder(p: string) { this._placeholder = p; return this; },
				setValue(v: string) { this._value = v; return this; },
				setDisabled(d: boolean) { this._disabled = d; return this; },
				onChange(fn: Function) { this._onChange = fn; return this; },
			};
			this._texts.push(t);
			cb(t);
			return this;
		}

		addToggle(cb: Function) {
			const t: any = {
				_value: false, _onChange: null, _disabled: false,
				setValue(v: boolean) { this._value = v; return this; },
				setDisabled(d: boolean) { this._disabled = d; return this; },
				onChange(fn: Function) { this._onChange = fn; return this; },
			};
			this._toggles.push(t);
			cb(t);
			return this;
		}

		addDropdown(cb: Function) {
			const d: any = {
				_options: {} as Record<string, string>,
				_value: '', _onChange: null, _disabled: false,
				selectEl: { style: {} as Record<string, string> },
				addOption(value: string, label: string) { this._options[value] = label; return this; },
				setValue(v: string) { this._value = v; return this; },
				setDisabled(d: boolean) { this._disabled = d; return this; },
				onChange(fn: Function) { this._onChange = fn; return this; },
			};
			this._dropdowns.push(d);
			cb(d);
			return this;
		}

		addButton(cb: Function) {
			const b: any = {
				_text: '', _cta: false, _disabled: false, _onClick: null,
				setButtonText(t: string) { this._text = t; return this; },
				setCta() { this._cta = true; return this; },
				setWarning() { return this; },
				setDisabled(d: boolean) { this._disabled = d; return this; },
				onClick(fn: Function) { this._onClick = fn; return this; },
			};
			this._buttons.push(b);
			cb(b);
			return this;
		}
	},
	Notice: vi.fn(),
	setIcon: vi.fn(),
}));

import { Notice } from 'obsidian';

// ---------------------------------------------------------------------------
// Mock DOM element factory
// ---------------------------------------------------------------------------

function createMockElement(tag = 'div'): any {
	const listeners: Record<string, Function[]> = {};
	const classSet = new Set<string>();
	const attributes: Record<string, string> = {};
	const children: any[] = [];

	const el: any = {
		tagName: tag.toUpperCase(),
		textContent: '',
		value: '',
		get className() { return [...classSet].join(' '); },
		set className(v: string) {
			classSet.clear();
			v.split(' ').filter(Boolean).forEach(c => classSet.add(c));
		},
		children,
		firstChild: null,
		get scrollHeight() { return 100; },
		scrollTop: 0,
		classList: {
			add: (c: string) => classSet.add(c),
			remove: (c: string) => classSet.delete(c),
			toggle: (c: string, force?: boolean): boolean => {
				const next = force !== undefined ? force : !classSet.has(c);
				if (next) classSet.add(c); else classSet.delete(c);
				return next;
			},
			contains: (c: string) => classSet.has(c),
		},
		style: {} as Record<string, string>,
		createEl(childTag: string, options?: any) {
			const child = createMockElement(childTag);
			if (options?.cls) child.className = options.cls;
			if (options?.text) child.textContent = options.text;
			if (options?.attr) {
				Object.entries(options.attr).forEach(([k, v]) => child.setAttribute(k, v as string));
			}
			children.push(child);
			return child;
		},
		empty() { children.length = 0; },
		setAttribute(n: string, v: string) { attributes[n] = v; },
		getAttribute(n: string) { return attributes[n] ?? null; },
		addEventListener(e: string, h: Function) { (listeners[e] ??= []).push(h); },
		removeEventListener(e: string, h: Function) {
			if (listeners[e]) listeners[e] = listeners[e].filter(f => f !== h);
		},
		remove: vi.fn(),
		focus: vi.fn(),
		querySelectorAll(sel: string): any[] {
			const cls = sel.startsWith('.') ? sel.slice(1) : null;
			const results: any[] = [];
			const walk = (node: any) => {
				if (cls && node.className?.includes(cls)) results.push(node);
				node.children?.forEach(walk);
			};
			children.forEach(walk);
			return results;
		},
		_trigger(event: string) { listeners[event]?.forEach(h => h()); },
	};
	return el;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSettings(overrides: Partial<LumenSettings> = {}): LumenSettings {
	return { ...DEFAULT_SETTINGS, ...overrides };
}

function createMockPlugin(settingsOverrides: Partial<LumenSettings> = {}) {
	return {
		settings: createSettings(settingsOverrides),
		saveSettings: vi.fn().mockResolvedValue(undefined),
		triggerSync: vi.fn().mockResolvedValue(undefined),
		activateDebugLogView: vi.fn(),
		apiClient: {
			testConnection: vi.fn().mockResolvedValue({
				status: 'healthy',
				timestamp: '2026-02-13T12:00:00Z',
				version: 'dev',
				uptime_seconds: 3600,
				components: [],
				chunk_count: 200,
			}),
			updateSettings: vi.fn(),
		},
		syncManager: {
			getState: vi.fn().mockReturnValue('idle'),
		},
		app: {
			vault: { getAbstractFileByPath: vi.fn().mockReturnValue(null) },
			workspace: { openLinkText: vi.fn().mockResolvedValue(undefined) },
		},
	};
}

/** Find a Setting instance by its name. */
function findSetting(name: string) {
	return settingInstances.find((s: any) => s._name === name);
}

/** Find a Setting that has a button with the given text. */
function findSettingWithButton(buttonText: string) {
	return settingInstances.find((s: any) =>
		s._buttons.some((b: any) => b._text === buttonText),
	);
}

/** Find section headers by text in containerEl. */
function findSectionHeaders(containerEl: any): any[] {
	return containerEl.children.filter(
		(c: any) => c.className?.includes('lumen-section-header'),
	);
}

/** Find section content divs in containerEl. */
function findSectionContents(containerEl: any): any[] {
	return containerEl.children.filter(
		(c: any) => c.className?.includes('lumen-section-content'),
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LumenSettingTab', () => {
	let mockPlugin: ReturnType<typeof createMockPlugin>;
	let tab: LumenSettingTab;
	let containerEl: any;

	beforeEach(() => {
		vi.clearAllMocks();
		settingInstances.length = 0;

		mockPlugin = createMockPlugin({
			apiKey: 'vr_test_key_12345',
			workspaceId: 'ws-001',
			deviceId: 'dev-001',
			lastSyncAt: '',
		});

		tab = new LumenSettingTab(mockPlugin.app as any, mockPlugin as any);
		containerEl = createMockElement('div');
		(tab as any).containerEl = containerEl;
		tab.display();
	});

	// -------------------------------------------------------------------
	// Section rendering
	// -------------------------------------------------------------------

	describe('section rendering', () => {
		it('renders heading', () => {
			const h2 = containerEl.children.find((c: any) => c.tagName === 'H2');
			expect(h2).toBeDefined();
			expect(h2.textContent).toBe('Lumen Settings');
		});

		it('renders 3 section headers', () => {
			const headers = findSectionHeaders(containerEl);
			expect(headers).toHaveLength(3);
		});

		it('renders 3 section content areas', () => {
			const contents = findSectionContents(containerEl);
			expect(contents).toHaveLength(3);
		});

		it('section headers have correct titles', () => {
			const headers = findSectionHeaders(containerEl);
			const titles = headers.map((h: any) =>
				h.children.find((c: any) => c.tagName === 'SPAN' && !c.className.includes('chevron'))?.textContent,
			);
			expect(titles).toEqual(['Connection', 'Vault Sync', 'Advanced']);
		});
	});

	// -------------------------------------------------------------------
	// Collapsible sections
	// -------------------------------------------------------------------

	describe('collapsible sections', () => {
		it('Connection section starts expanded', () => {
			const contents = findSectionContents(containerEl);
			expect(contents[0].classList.contains('lumen-section-collapsed')).toBe(false);
		});

		it('Vault Sync section starts expanded', () => {
			const contents = findSectionContents(containerEl);
			expect(contents[1].classList.contains('lumen-section-collapsed')).toBe(false);
		});

		it('Advanced section starts collapsed', () => {
			const contents = findSectionContents(containerEl);
			expect(contents[2].classList.contains('lumen-section-collapsed')).toBe(true);
		});

		it('clicking header toggles collapse', () => {
			const headers = findSectionHeaders(containerEl);
			const contents = findSectionContents(containerEl);

			// Connection starts expanded — click to collapse
			expect(contents[0].classList.contains('lumen-section-collapsed')).toBe(false);
			headers[0]._trigger('click');
			expect(contents[0].classList.contains('lumen-section-collapsed')).toBe(true);

			// Click again to expand
			headers[0]._trigger('click');
			expect(contents[0].classList.contains('lumen-section-collapsed')).toBe(false);
		});

		it('clicking Advanced header expands it', () => {
			const headers = findSectionHeaders(containerEl);
			const contents = findSectionContents(containerEl);

			expect(contents[2].classList.contains('lumen-section-collapsed')).toBe(true);
			headers[2]._trigger('click');
			expect(contents[2].classList.contains('lumen-section-collapsed')).toBe(false);
		});
	});

	// -------------------------------------------------------------------
	// Connection settings
	// -------------------------------------------------------------------

	describe('Connection settings', () => {
		it('creates Server setting with baked-in URL', () => {
			const s = findSetting('Server');
			expect(s).toBeDefined();
			expect(s._desc).toBe(LUMEN_API_URL);
		});

		it('creates API Key setting with password input', () => {
			const s = findSetting('API Key');
			expect(s).toBeDefined();
			expect(s._texts[0].inputEl.type).toBe('password');
			expect(s._texts[0].inputEl.autocomplete).toBe('off');
		});

		it('API Key onChange updates settings and saves', async () => {
			const s = findSetting('API Key');
			await s._texts[0]._onChange('vr_new_key_abc');
			expect(mockPlugin.settings.apiKey).toBe('vr_new_key_abc');
			expect(mockPlugin.saveSettings).toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------
	// Connection test button
	// -------------------------------------------------------------------

	describe('Test Connection', () => {
		it('creates Test Connection setting with button', () => {
			const s = findSetting('Test Connection');
			expect(s).toBeDefined();
			expect(s._buttons).toHaveLength(1);
		});

		it('shows success notice on successful connection', async () => {
			const s = findSetting('Test Connection');
			await s._buttons[0]._onClick();
			expect(Notice).toHaveBeenCalledWith('Connected!');
		});

		it('shows error notice on connection failure', async () => {
			mockPlugin.apiClient.testConnection.mockRejectedValueOnce(
				new Error('ECONNREFUSED'),
			);
			const s = findSetting('Test Connection');
			await s._buttons[0]._onClick();
			expect(Notice).toHaveBeenCalledWith(
				expect.stringContaining('Connection failed'),
			);
		});

		it('requires API Key before testing', async () => {
			mockPlugin.settings.apiKey = '';
			settingInstances.length = 0;
			tab.display();

			const s = findSetting('Test Connection');
			await s._buttons[0]._onClick();
			expect(Notice).toHaveBeenCalledWith(
				expect.stringContaining('API key'),
			);
			expect(mockPlugin.apiClient.testConnection).not.toHaveBeenCalled();
		});
	});

	// Vault Sync settings are now managed by the sync manager directly
	// (registration + sync status endpoints), not via a workspace config fetch.

	// -------------------------------------------------------------------
	// Sync action buttons
	// -------------------------------------------------------------------

	describe('Sync Now button', () => {
		it('calls plugin.triggerSync', async () => {
			const s = findSettingWithButton('Sync Now');
			expect(s).toBeDefined();

			const btn = s._buttons.find((b: any) => b._text === 'Sync Now');
			await btn._onClick();

			expect(mockPlugin.triggerSync).toHaveBeenCalledOnce();
		});

		it('re-enables button after sync completes', async () => {
			const s = findSettingWithButton('Sync Now');
			const btn = s._buttons.find((b: any) => b._text === 'Sync Now');
			await btn._onClick();

			// After await, button should be re-enabled
			expect(btn._text).toBe('Sync Now');
			expect(btn._disabled).toBe(false);
		});
	});

	describe('View Conflict Log button', () => {
		it('shows notice when no conflict log exists', async () => {
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
			const s = findSettingWithButton('View Conflict Log');
			const btn = s._buttons.find((b: any) => b._text === 'View Conflict Log');

			await btn._onClick();

			expect(Notice).toHaveBeenCalledWith(
				expect.stringContaining('No conflict log found'),
			);
		});

		it('opens conflict log when it exists', async () => {
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue({ path: '.lumen-conflicts.md' });
			const s = findSettingWithButton('View Conflict Log');
			const btn = s._buttons.find((b: any) => b._text === 'View Conflict Log');

			await btn._onClick();

			expect(mockPlugin.app.workspace.openLinkText).toHaveBeenCalledWith(
				'.lumen-conflicts.md', '',
			);
		});
	});

	// -------------------------------------------------------------------
	// Advanced section
	// -------------------------------------------------------------------

	describe('Advanced settings', () => {
		it('shows Workspace ID as readonly', () => {
			const s = findSetting('Workspace ID');
			expect(s).toBeDefined();
			expect(s._texts[0]._value).toBe('ws-001');
			expect(s._texts[0]._disabled).toBe(true);
		});

		it('shows Device ID as readonly', () => {
			const s = findSetting('Device ID');
			expect(s).toBeDefined();
			expect(s._texts[0]._value).toBe('dev-001');
			expect(s._texts[0]._disabled).toBe(true);
		});

		it('shows "Not configured" when IDs are empty', () => {
			mockPlugin.settings.workspaceId = '';
			mockPlugin.settings.deviceId = '';
			settingInstances.length = 0;
			tab.display();

			expect(findSetting('Workspace ID')._texts[0]._value).toBe('Not configured');
			expect(findSetting('Device ID')._texts[0]._value).toBe('Not configured');
		});

		it('creates debug mode toggle', () => {
			const s = findSetting('Debug mode');
			expect(s).toBeDefined();
			expect(s._toggles).toHaveLength(1);
		});

		it('debug toggle onChange updates settings and saves', async () => {
			const s = findSetting('Debug mode');
			await s._toggles[0]._onChange(true);
			expect(mockPlugin.settings.debugMode).toBe(true);
			expect(mockPlugin.saveSettings).toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------
	// Sync info display
	// -------------------------------------------------------------------

	describe('sync info', () => {
		it('shows "Never" when no lastSyncAt', () => {
			const contents = findSectionContents(containerEl);
			const syncContent = contents[1];
			const infoEl = syncContent.children.find(
				(c: any) => c.className?.includes('lumen-sync-info'),
			);
			expect(infoEl).toBeDefined();
			const valueSpan = infoEl.children[0]?.children?.find(
				(c: any) => c.className?.includes('lumen-sync-info-value'),
			);
			expect(valueSpan?.textContent).toBe('Never');
		});

		it('shows relative time when lastSyncAt is set', () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-02-13T12:05:00Z'));
			mockPlugin.settings.lastSyncAt = '2026-02-13T12:00:00Z';
			settingInstances.length = 0;
			tab.display();

			const contents = findSectionContents(containerEl);
			const syncContent = contents[1];
			const infoEl = syncContent.children.find(
				(c: any) => c.className?.includes('lumen-sync-info'),
			);
			const valueSpan = infoEl.children[0]?.children?.find(
				(c: any) => c.className?.includes('lumen-sync-info-value'),
			);
			expect(valueSpan?.textContent).toBe('5 min ago');
			vi.useRealTimers();
		});

		it('shows sync state when not idle', () => {
			mockPlugin.syncManager.getState.mockReturnValue('uploading');
			settingInstances.length = 0;
			tab.display();

			const contents = findSectionContents(containerEl);
			const syncContent = contents[1];
			const infoEl = syncContent.children.find(
				(c: any) => c.className?.includes('lumen-sync-info'),
			);
			// Should have 2 rows: Last sync + Status
			const rows = infoEl.children.filter(
				(c: any) => c.className?.includes('lumen-sync-info-row'),
			);
			expect(rows.length).toBe(2);
			const statusValue = rows[1].children.find(
				(c: any) => c.className?.includes('lumen-sync-info-value'),
			);
			expect(statusValue?.textContent).toBe('Uploading');
		});
	});

	// -------------------------------------------------------------------
	// display() re-render
	// -------------------------------------------------------------------

	describe('display re-render', () => {
		it('clears container on re-display', () => {
			// display() was already called in beforeEach
			const childCountBefore = containerEl.children.length;
			expect(childCountBefore).toBeGreaterThan(0);

			// Call display again — should clear first
			settingInstances.length = 0;
			tab.display();

			// Container should have been emptied and re-populated
			// (same number of children as before)
			expect(containerEl.children.length).toBe(childCountBefore);
		});
	});
});
