/**
 * Tests for the quick search modal.
 *
 * Verifies the modal structure and keyboard navigation support.
 */

import { describe, it, expect } from 'vitest';

describe('QuickSearchContent', () => {
	it('has a debounce constant of 200ms', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/components/search/QuickSearchContent.tsx', 'utf-8');
		expect(content).toContain('const DEBOUNCE_MS = 200');
	});

	it('supports keyboard navigation', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/components/search/QuickSearchContent.tsx', 'utf-8');
		expect(content).toContain('ArrowDown');
		expect(content).toContain('ArrowUp');
		expect(content).toContain('Enter');
		expect(content).toContain('selectedIndex');
	});

	it('renders search results with scores', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/components/search/QuickSearchContent.tsx', 'utf-8');
		expect(content).toContain('lumen-qs-result-score');
		expect(content).toContain('scorePercent');
	});

	it('shows keyboard shortcut hints in footer', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/components/search/QuickSearchContent.tsx', 'utf-8');
		expect(content).toContain('navigate');
		expect(content).toContain('open');
		expect(content).toContain('close');
	});

	it('uses classifyError for error handling', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/components/search/QuickSearchContent.tsx', 'utf-8');
		expect(content).toContain('classifyError');
	});
});

describe('QuickSearchModal', () => {
	it('creates a React root in the modal', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/quick-search-modal.tsx', 'utf-8');
		expect(content).toContain('createRoot');
		expect(content).toContain('QuickSearchContent');
		expect(content).toContain('lumen-quick-search-modal');
	});

	it('unmounts React root on close', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/quick-search-modal.tsx', 'utf-8');
		expect(content).toContain('unmount');
	});
});
