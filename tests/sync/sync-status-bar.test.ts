/**
 * SyncStatusBar unit tests.
 *
 * Tests state rendering, CSS class transitions, click-to-retry,
 * progress display, relative time formatting, ARIA labels,
 * and destroy() cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncStatusBar, formatRelativeTime } from '../../src/sync/sync-status-bar';
import type { SyncState } from '../../src/types';

// ---------------------------------------------------------------------------
// Mock obsidian module
// ---------------------------------------------------------------------------

vi.mock('obsidian', () => ({
	setIcon: vi.fn(),
}));

import { setIcon } from 'obsidian';

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
		get className() { return [...classSet].join(' '); },
		set className(v: string) {
			classSet.clear();
			v.split(' ').filter(Boolean).forEach(c => classSet.add(c));
		},
		children,
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
		// Test helpers
		_trigger(event: string) { listeners[event]?.forEach(h => h()); },
		_listenerCount(event: string) { return listeners[event]?.length ?? 0; },
	};
	return el;
}

/** After construction, statusBarEl.children[0] is the container */
function getContainer(statusBarEl: any) { return statusBarEl.children[0]; }

/** Container's second child is the text span */
function getTextEl(statusBarEl: any) { return getContainer(statusBarEl).children[1]; }

// ---------------------------------------------------------------------------
// Tests: formatRelativeTime (exported pure function)
// ---------------------------------------------------------------------------

describe('formatRelativeTime', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('returns "just now" for < 60 seconds', () => {
		vi.setSystemTime(new Date('2026-02-13T12:01:00Z'));
		expect(formatRelativeTime('2026-02-13T12:00:30Z')).toBe('just now');
	});

	it('returns "just now" for 0 seconds', () => {
		vi.setSystemTime(new Date('2026-02-13T12:00:00Z'));
		expect(formatRelativeTime('2026-02-13T12:00:00Z')).toBe('just now');
	});

	it('returns "1 min ago" for exactly 60 seconds', () => {
		vi.setSystemTime(new Date('2026-02-13T12:01:00Z'));
		expect(formatRelativeTime('2026-02-13T12:00:00Z')).toBe('1 min ago');
	});

	it('returns "N min ago" for multiple minutes', () => {
		vi.setSystemTime(new Date('2026-02-13T12:15:00Z'));
		expect(formatRelativeTime('2026-02-13T12:00:00Z')).toBe('15 min ago');
	});

	it('returns "59 min ago" at boundary before hours', () => {
		vi.setSystemTime(new Date('2026-02-13T12:59:00Z'));
		expect(formatRelativeTime('2026-02-13T12:00:00Z')).toBe('59 min ago');
	});

	it('returns "1 hour ago" for exactly 60 minutes', () => {
		vi.setSystemTime(new Date('2026-02-13T13:00:00Z'));
		expect(formatRelativeTime('2026-02-13T12:00:00Z')).toBe('1 hour ago');
	});

	it('returns "N hours ago" for multiple hours', () => {
		vi.setSystemTime(new Date('2026-02-13T18:00:00Z'));
		expect(formatRelativeTime('2026-02-13T12:00:00Z')).toBe('6 hours ago');
	});

	it('returns "23 hours ago" at boundary before yesterday', () => {
		vi.setSystemTime(new Date('2026-02-14T11:00:00Z'));
		expect(formatRelativeTime('2026-02-13T12:00:00Z')).toBe('23 hours ago');
	});

	it('returns "yesterday" for 24-48 hours', () => {
		vi.setSystemTime(new Date('2026-02-14T12:00:00Z'));
		expect(formatRelativeTime('2026-02-13T12:00:00Z')).toBe('yesterday');
	});

	it('returns "yesterday" at 47 hours', () => {
		vi.setSystemTime(new Date('2026-02-15T11:00:00Z'));
		expect(formatRelativeTime('2026-02-13T12:00:00Z')).toBe('yesterday');
	});

	it('returns "N days ago" for >= 48 hours', () => {
		vi.setSystemTime(new Date('2026-02-18T12:00:00Z'));
		expect(formatRelativeTime('2026-02-13T12:00:00Z')).toBe('5 days ago');
	});

	it('returns "2 days ago" at exactly 48 hours', () => {
		vi.setSystemTime(new Date('2026-02-15T12:00:00Z'));
		expect(formatRelativeTime('2026-02-13T12:00:00Z')).toBe('2 days ago');
	});

	it('returns "just now" for future timestamps', () => {
		vi.setSystemTime(new Date('2026-02-13T12:00:00Z'));
		expect(formatRelativeTime('2026-02-13T12:05:00Z')).toBe('just now');
	});

	it('returns "just now" for invalid timestamps', () => {
		expect(formatRelativeTime('not-a-date')).toBe('just now');
	});
});

// ---------------------------------------------------------------------------
// Tests: SyncStatusBar
// ---------------------------------------------------------------------------

describe('SyncStatusBar', () => {
	let statusBarEl: any;
	let onRetry: ReturnType<typeof vi.fn>;
	let bar: SyncStatusBar;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-02-13T12:00:00Z'));
		statusBarEl = createMockElement('div');
		onRetry = vi.fn();
		bar = new SyncStatusBar(statusBarEl, onRetry);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// -------------------------------------------------------------------
	// Constructor / initial state
	// -------------------------------------------------------------------

	describe('constructor', () => {
		it('creates container span in status bar', () => {
			expect(statusBarEl.children).toHaveLength(1);
			expect(getContainer(statusBarEl).tagName).toBe('SPAN');
		});

		it('sets initial CSS classes', () => {
			const cn = getContainer(statusBarEl).className;
			expect(cn).toContain('lumen-sync-status-bar');
			expect(cn).toContain('lumen-sync-idle');
		});

		it('creates icon and text child elements', () => {
			const container = getContainer(statusBarEl);
			expect(container.children).toHaveLength(2);
			expect(container.children[0].className).toContain('lumen-sync-icon');
			expect(container.children[1].className).toContain('lumen-sync-text');
		});

		it('sets initial text to "Lumen"', () => {
			expect(getTextEl(statusBarEl).textContent).toBe('Lumen');
		});

		it('sets ARIA role and label', () => {
			const c = getContainer(statusBarEl);
			expect(c.getAttribute('role')).toBe('status');
			expect(c.getAttribute('aria-label')).toBe('Lumen sync status');
		});

		it('registers click handler', () => {
			expect(getContainer(statusBarEl)._listenerCount('click')).toBe(1);
		});

		it('calls setIcon with idle icon', () => {
			expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'lumen-logo');
		});
	});

	// -------------------------------------------------------------------
	// update() — text rendering per state
	// -------------------------------------------------------------------

	describe('update text', () => {
		it('idle shows "Lumen" when no lastSyncAt', () => {
			bar.update('idle');
			expect(getTextEl(statusBarEl).textContent).toBe('Lumen');
		});

		it('idle shows relative time when lastSyncAt is set', () => {
			vi.setSystemTime(new Date('2026-02-13T12:05:00Z'));
			bar.setLastSyncAt('2026-02-13T12:00:00Z');
			bar.update('idle');
			expect(getTextEl(statusBarEl).textContent).toBe('Last sync: 5 min ago');
		});

		it('hashing without progress', () => {
			bar.update('hashing');
			expect(getTextEl(statusBarEl).textContent).toBe('Hashing...');
		});

		it('hashing with progress', () => {
			bar.update('hashing', { current: 50, total: 200 });
			expect(getTextEl(statusBarEl).textContent).toBe('Hashing... 50/200');
		});

		it('manifest state', () => {
			bar.update('manifest');
			expect(getTextEl(statusBarEl).textContent).toBe('Preparing sync...');
		});

		it('uploading without progress', () => {
			bar.update('uploading');
			expect(getTextEl(statusBarEl).textContent).toBe('Uploading...');
		});

		it('uploading with progress', () => {
			bar.update('uploading', { current: 5, total: 34 });
			expect(getTextEl(statusBarEl).textContent).toBe('Uploading 34 file(s)...');
		});

		it('success shows file count when files were uploaded', () => {
			bar.update('uploading', { current: 5, total: 34 });
			bar.update('success');
			expect(getTextEl(statusBarEl).textContent).toBe('Synced 34 file(s)');
		});

		it('success shows "Up to date" when no files uploaded', () => {
			bar.update('success');
			expect(getTextEl(statusBarEl).textContent).toBe('Up to date');
		});

		it('error state', () => {
			bar.update('error');
			expect(getTextEl(statusBarEl).textContent).toBe('Sync failed (click to retry)');
		});
	});

	// -------------------------------------------------------------------
	// update() — CSS class transitions
	// -------------------------------------------------------------------

	describe('CSS classes', () => {
		const stateClassMap: Record<SyncState, string> = {
			idle: 'lumen-sync-idle',
			hashing: 'lumen-sync-active',
			manifest: 'lumen-sync-active',
			uploading: 'lumen-sync-active',
			success: 'lumen-sync-success',
			error: 'lumen-sync-error',
		};

		for (const [state, expectedClass] of Object.entries(stateClassMap)) {
			it(`applies ${expectedClass} for "${state}"`, () => {
				bar.update(state as SyncState);
				const cn = getContainer(statusBarEl).className;
				expect(cn).toContain('lumen-sync-status-bar');
				expect(cn).toContain(expectedClass);
			});
		}

		it('replaces previous state class on transition', () => {
			bar.update('hashing');
			expect(getContainer(statusBarEl).className).toContain('lumen-sync-active');

			bar.update('error');
			const cn = getContainer(statusBarEl).className;
			expect(cn).not.toContain('lumen-sync-active');
			expect(cn).toContain('lumen-sync-error');
		});
	});

	// -------------------------------------------------------------------
	// update() — icons
	// -------------------------------------------------------------------

	describe('icons', () => {
		const stateIconMap: Record<SyncState, string> = {
			idle: 'lumen-logo',
			hashing: 'loader-2',
			manifest: 'loader-2',
			uploading: 'loader-2',
			success: 'check-circle',
			error: 'alert-triangle',
		};

		for (const [state, icon] of Object.entries(stateIconMap)) {
			it(`uses "${icon}" icon for "${state}"`, () => {
				vi.mocked(setIcon).mockClear();
				bar.update(state as SyncState);
				expect(setIcon).toHaveBeenCalledWith(expect.anything(), icon);
			});
		}
	});

	// -------------------------------------------------------------------
	// update() — ARIA labels
	// -------------------------------------------------------------------

	describe('ARIA labels', () => {
		it('updates for hashing with progress', () => {
			bar.update('hashing', { current: 10, total: 50 });
			expect(getContainer(statusBarEl).getAttribute('aria-label'))
				.toBe('Lumen sync: Hashing... 10/50');
		});

		it('updates for error', () => {
			bar.update('error');
			expect(getContainer(statusBarEl).getAttribute('aria-label'))
				.toBe('Lumen sync: Sync failed (click to retry)');
		});

		it('updates for success', () => {
			bar.update('success');
			expect(getContainer(statusBarEl).getAttribute('aria-label'))
				.toBe('Lumen sync: Up to date');
		});

		it('updates for idle with last sync', () => {
			vi.setSystemTime(new Date('2026-02-13T12:02:00Z'));
			bar.setLastSyncAt('2026-02-13T12:00:00Z');
			bar.update('idle');
			expect(getContainer(statusBarEl).getAttribute('aria-label'))
				.toBe('Lumen sync: Last sync: 2 min ago');
		});
	});

	// -------------------------------------------------------------------
	// Full state transition flow
	// -------------------------------------------------------------------

	describe('state transitions', () => {
		it('renders full sync flow correctly', () => {
			const texts: string[] = [];

			bar.update('idle');
			texts.push(getTextEl(statusBarEl).textContent);

			bar.update('hashing', { current: 50, total: 100 });
			texts.push(getTextEl(statusBarEl).textContent);

			bar.update('manifest');
			texts.push(getTextEl(statusBarEl).textContent);

			bar.update('uploading', { current: 5, total: 20 });
			texts.push(getTextEl(statusBarEl).textContent);

			bar.update('success');
			texts.push(getTextEl(statusBarEl).textContent);

			expect(texts).toEqual([
				'Lumen',
				'Hashing... 50/100',
				'Preparing sync...',
				'Uploading 20 file(s)...',
				'Synced 20 file(s)',
			]);
		});
	});

	// -------------------------------------------------------------------
	// setLastSyncAt
	// -------------------------------------------------------------------

	describe('setLastSyncAt', () => {
		it('updates idle text with relative time', () => {
			vi.setSystemTime(new Date('2026-02-13T12:02:00Z'));
			bar.setLastSyncAt('2026-02-13T12:00:00Z');
			expect(getTextEl(statusBarEl).textContent).toBe('Last sync: 2 min ago');
		});

		it('does not update text when not in idle state', () => {
			bar.update('hashing', { current: 10, total: 50 });
			const hashingText = getTextEl(statusBarEl).textContent;

			bar.setLastSyncAt('2026-02-13T12:00:00Z');
			expect(getTextEl(statusBarEl).textContent).toBe(hashingText);
		});

		it('uses stored timestamp when returning to idle', () => {
			vi.setSystemTime(new Date('2026-02-13T12:10:00Z'));
			bar.setLastSyncAt('2026-02-13T12:00:00Z');

			bar.update('uploading', { current: 1, total: 5 });
			expect(getTextEl(statusBarEl).textContent).toBe('Uploading 5 file(s)...');

			bar.update('idle');
			expect(getTextEl(statusBarEl).textContent).toBe('Last sync: 10 min ago');
		});
	});

	// -------------------------------------------------------------------
	// Click to retry
	// -------------------------------------------------------------------

	describe('click to retry', () => {
		it('calls onRetry in error state', () => {
			bar.update('error');
			getContainer(statusBarEl)._trigger('click');
			expect(onRetry).toHaveBeenCalledOnce();
		});

		it('triggers sync on click in idle state', () => {
			bar.update('idle');
			getContainer(statusBarEl)._trigger('click');
			expect(onRetry).toHaveBeenCalledOnce();
		});

		it('does NOT call onRetry in hashing state', () => {
			bar.update('hashing');
			getContainer(statusBarEl)._trigger('click');
			expect(onRetry).not.toHaveBeenCalled();
		});

		it('does NOT call onRetry in uploading state', () => {
			bar.update('uploading');
			getContainer(statusBarEl)._trigger('click');
			expect(onRetry).not.toHaveBeenCalled();
		});

		it('does NOT call onRetry in success state', () => {
			bar.update('success');
			getContainer(statusBarEl)._trigger('click');
			expect(onRetry).not.toHaveBeenCalled();
		});

		it('does NOT call onRetry in manifest state', () => {
			bar.update('manifest');
			getContainer(statusBarEl)._trigger('click');
			expect(onRetry).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------
	// destroy()
	// -------------------------------------------------------------------

	describe('destroy', () => {
		it('removes click listener', () => {
			expect(getContainer(statusBarEl)._listenerCount('click')).toBe(1);
			bar.destroy();
			expect(getContainer(statusBarEl)._listenerCount('click')).toBe(0);
		});

		it('removes container from DOM', () => {
			bar.destroy();
			expect(getContainer(statusBarEl).remove).toHaveBeenCalledOnce();
		});

		it('click does not trigger retry after destroy', () => {
			bar.update('error');
			bar.destroy();
			getContainer(statusBarEl)._trigger('click');
			expect(onRetry).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------
	// Progress display
	// -------------------------------------------------------------------

	describe('progress display', () => {
		it('shows large counts for hashing', () => {
			bar.update('hashing', { current: 234, total: 1000 });
			expect(getTextEl(statusBarEl).textContent).toBe('Hashing... 234/1000');
		});

		it('shows 0/N at start', () => {
			bar.update('hashing', { current: 0, total: 500 });
			expect(getTextEl(statusBarEl).textContent).toBe('Hashing... 0/500');
		});

		it('tracks upload total for success message', () => {
			bar.update('uploading', { current: 10, total: 42 });
			bar.update('success');
			expect(getTextEl(statusBarEl).textContent).toBe('Synced 42 file(s)');
		});

		it('updates upload count on subsequent uploading state', () => {
			bar.update('uploading', { current: 1, total: 10 });
			bar.update('uploading', { current: 5, total: 10 });
			bar.update('success');
			expect(getTextEl(statusBarEl).textContent).toBe('Synced 10 file(s)');
		});
	});

	// -------------------------------------------------------------------
	// Feature 3: Indexing progress display
	// -------------------------------------------------------------------

	describe('showIndexingProgress', () => {
		it('shows indexing text with counts and percentage', () => {
			bar.showIndexingProgress(50, 200, 25);
			expect(getTextEl(statusBarEl).textContent).toBe('Indexing: 50/200 (25%)');
		});

		it('rounds percentage to integer', () => {
			bar.showIndexingProgress(33, 100, 33.333);
			expect(getTextEl(statusBarEl).textContent).toBe('Indexing: 33/100 (33%)');
		});

		it('applies active CSS class', () => {
			bar.showIndexingProgress(10, 50, 20);
			expect(getContainer(statusBarEl).className).toContain('lumen-sync-active');
		});

		it('sets database icon', () => {
			vi.mocked(setIcon).mockClear();
			bar.showIndexingProgress(10, 50, 20);
			expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'database');
		});

		it('sets aria-busy to true', () => {
			bar.showIndexingProgress(10, 50, 20);
			expect(getContainer(statusBarEl).getAttribute('aria-busy')).toBe('true');
		});

		it('sets aria-label with indexing text', () => {
			bar.showIndexingProgress(10, 50, 20);
			expect(getContainer(statusBarEl).getAttribute('aria-label'))
				.toBe('Lumen: Indexing: 10/50 (20%)');
		});

		it('shows 0% at start', () => {
			bar.showIndexingProgress(0, 100, 0);
			expect(getTextEl(statusBarEl).textContent).toBe('Indexing: 0/100 (0%)');
		});

		it('shows 100% at completion', () => {
			bar.showIndexingProgress(100, 100, 100);
			expect(getTextEl(statusBarEl).textContent).toBe('Indexing: 100/100 (100%)');
		});

		it('shows "Server reindexing" when serverTriggered is true', () => {
			bar.showIndexingProgress(30, 200, 15, true);
			expect(getTextEl(statusBarEl).textContent).toBe('Server reindexing: 30/200 (15%)');
		});

		it('shows "Indexing" when serverTriggered is false', () => {
			bar.showIndexingProgress(30, 200, 15, false);
			expect(getTextEl(statusBarEl).textContent).toBe('Indexing: 30/200 (15%)');
		});

		it('shows "Indexing" when serverTriggered is omitted', () => {
			bar.showIndexingProgress(30, 200, 15);
			expect(getTextEl(statusBarEl).textContent).toBe('Indexing: 30/200 (15%)');
		});

		it('sets correct aria-label for server-triggered indexing', () => {
			bar.showIndexingProgress(10, 50, 20, true);
			expect(getContainer(statusBarEl).getAttribute('aria-label'))
				.toBe('Lumen: Server reindexing: 10/50 (20%)');
		});
	});
});
