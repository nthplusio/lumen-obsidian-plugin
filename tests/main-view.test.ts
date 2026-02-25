/**
 * Unit tests for the React-based Main Sidebar View.
 *
 * Tests the thin ItemView wrapper (LumenMainView) and verifies that:
 *   - View metadata (type, display text, icon) is correct
 *   - onOpen creates a React root and renders into the container
 *   - onClose unmounts the React root
 *
 * Component-level tests for SearchView, ChatView, and hooks are in
 * separate test files under tests/ui/.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LumenMainView, VIEW_TYPE_LUMEN_MAIN } from '../src/main-view';

// ---------------------------------------------------------------------------
// Mock react-dom/client
// ---------------------------------------------------------------------------

const mockRender = vi.fn();
const mockUnmount = vi.fn();
const mockCreateRoot = vi.fn(() => ({
	render: mockRender,
	unmount: mockUnmount,
}));

vi.mock('react-dom/client', () => ({
	createRoot: (...args: any[]) => mockCreateRoot(...args),
}));

// ---------------------------------------------------------------------------
// Mock Obsidian
// ---------------------------------------------------------------------------

vi.mock('obsidian', () => ({
	ItemView: class {
		containerEl: any;
		app: any;
		constructor() {
			this.containerEl = { children: [null, null] };
			this.app = {};
		}
	},
	WorkspaceLeaf: class {},
	setIcon: vi.fn(),
	MarkdownRenderer: { render: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LumenMainView', () => {
	let view: LumenMainView;
	let mockPlugin: any;
	let containerEl: any;

	beforeEach(() => {
		vi.clearAllMocks();

		const contentEl = {
			empty: vi.fn(),
			addClass: vi.fn(),
			children: [],
			tagName: 'DIV',
			// createRoot needs a real-ish DOM element
			nodeType: 1,
		};

		containerEl = {
			children: [null, contentEl],
		};

		mockPlugin = {
			settings: { apiKey: 'test-key', apiUrl: 'http://test' },
			apiClient: { semanticSearch: vi.fn(), listTags: vi.fn() },
			chatClient: null,
		};

		view = new LumenMainView({} as any, mockPlugin);
		(view as any).containerEl = containerEl;
		(view as any).app = {
			vault: { getAbstractFileByPath: vi.fn() },
			workspace: { openLinkText: vi.fn() },
		};
	});

	describe('metadata', () => {
		it('returns correct view type', () => {
			expect(view.getViewType()).toBe(VIEW_TYPE_LUMEN_MAIN);
			expect(VIEW_TYPE_LUMEN_MAIN).toBe('lumen-main-view');
		});

		it('returns correct display text', () => {
			expect(view.getDisplayText()).toBe('Lumen');
		});

		it('returns correct icon', () => {
			expect(view.getIcon()).toBe('lumen-search');
		});
	});

	describe('onOpen', () => {
		it('creates a React root on the content container', async () => {
			await view.onOpen();

			expect(mockCreateRoot).toHaveBeenCalledTimes(1);
			const container = containerEl.children[1];
			expect(mockCreateRoot).toHaveBeenCalledWith(container);
		});

		it('calls empty and addClass on the container', async () => {
			await view.onOpen();

			const container = containerEl.children[1];
			expect(container.empty).toHaveBeenCalled();
			expect(container.addClass).toHaveBeenCalledWith('lumen-main-container');
		});

		it('renders a React component tree', async () => {
			await view.onOpen();

			expect(mockRender).toHaveBeenCalledTimes(1);
		});

		it('does nothing if container is missing', async () => {
			(view as any).containerEl = { children: [null] };
			await view.onOpen();

			expect(mockCreateRoot).not.toHaveBeenCalled();
		});
	});

	describe('onClose', () => {
		it('unmounts the React root', async () => {
			await view.onOpen();
			await view.onClose();

			expect(mockUnmount).toHaveBeenCalledTimes(1);
		});

		it('does nothing if React root was never created', async () => {
			await view.onClose();

			expect(mockUnmount).not.toHaveBeenCalled();
		});
	});
});
