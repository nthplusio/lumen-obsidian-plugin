/**
 * Unit tests for the Dataview Integration public JS API.
 *
 * Tests:
 *   - API version string
 *   - search() delegates to apiClient.semanticSearch()
 *   - getSimilar() delegates to apiClient.searchSimilarDocuments()
 *   - getTags() delegates to apiClient.listTags()
 *   - Experimental warning is logged once on first call
 *   - Options are correctly forwarded to the API client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLumenAPI, type LumenSearchAPI } from '../src/dataview-api';

// ---------------------------------------------------------------------------
// Mock API client
// ---------------------------------------------------------------------------

function createMockApiClient() {
	return {
		semanticSearch: vi.fn().mockResolvedValue([
			{ source_path: 'notes/test.md', score: 0.95, snippet: 'test content' },
		]),
		searchSimilarDocuments: vi.fn().mockResolvedValue([
			{ source_path: 'notes/similar.md', score: 0.80 },
		]),
		listTags: vi.fn().mockResolvedValue([
			{ tag: 'ai', count: 5 },
			{ tag: 'notes', count: 3 },
		]),
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dataview API', () => {
	let mockClient: ReturnType<typeof createMockApiClient>;
	let api: LumenSearchAPI;

	beforeEach(() => {
		vi.restoreAllMocks();
		mockClient = createMockApiClient();
		api = createLumenAPI(mockClient as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// -----------------------------------------------------------------------
	// Version
	// -----------------------------------------------------------------------

	describe('version', () => {
		it('exposes a version string', () => {
			expect(api.version).toBe('1.3.0');
		});
	});

	// -----------------------------------------------------------------------
	// search()
	// -----------------------------------------------------------------------

	describe('search()', () => {
		it('delegates to apiClient.semanticSearch()', async () => {
			const results = await api.search('machine learning');

			expect(mockClient.semanticSearch).toHaveBeenCalledOnce();
			expect(mockClient.semanticSearch).toHaveBeenCalledWith('machine learning', {
				limit: undefined,
				tags: undefined,
			});
			expect(results).toHaveLength(1);
			expect(results[0].source_path).toBe('notes/test.md');
		});

		it('forwards limit option', async () => {
			await api.search('query', { limit: 5 });

			expect(mockClient.semanticSearch).toHaveBeenCalledWith('query', {
				limit: 5,
				tags: undefined,
			});
		});

		it('forwards tags option', async () => {
			await api.search('query', { tags: ['ai', 'ml'] });

			expect(mockClient.semanticSearch).toHaveBeenCalledWith('query', {
				limit: undefined,
				tags: ['ai', 'ml'],
			});
		});

		it('forwards both limit and tags', async () => {
			await api.search('query', { limit: 10, tags: ['notes'] });

			expect(mockClient.semanticSearch).toHaveBeenCalledWith('query', {
				limit: 10,
				tags: ['notes'],
			});
		});

		it('propagates API client errors', async () => {
			mockClient.semanticSearch.mockRejectedValueOnce(new Error('Network error'));

			await expect(api.search('fail')).rejects.toThrow('Network error');
		});
	});

	// -----------------------------------------------------------------------
	// getSimilar()
	// -----------------------------------------------------------------------

	describe('getSimilar()', () => {
		it('delegates to apiClient.searchSimilarDocuments()', async () => {
			const results = await api.getSimilar('notes/source.md');

			expect(mockClient.searchSimilarDocuments).toHaveBeenCalledOnce();
			expect(mockClient.searchSimilarDocuments).toHaveBeenCalledWith('notes/source.md', {
				limit: undefined,
			});
			expect(results).toHaveLength(1);
			expect(results[0].source_path).toBe('notes/similar.md');
		});

		it('forwards limit option', async () => {
			await api.getSimilar('notes/source.md', { limit: 3 });

			expect(mockClient.searchSimilarDocuments).toHaveBeenCalledWith('notes/source.md', {
				limit: 3,
			});
		});

		it('propagates API client errors', async () => {
			mockClient.searchSimilarDocuments.mockRejectedValueOnce(new Error('404'));

			await expect(api.getSimilar('missing.md')).rejects.toThrow('404');
		});
	});

	// -----------------------------------------------------------------------
	// getTags()
	// -----------------------------------------------------------------------

	describe('getTags()', () => {
		it('delegates to apiClient.listTags()', async () => {
			const tags = await api.getTags();

			expect(mockClient.listTags).toHaveBeenCalledOnce();
			expect(tags).toHaveLength(2);
			expect(tags[0]).toEqual({ tag: 'ai', count: 5 });
		});

		it('propagates API client errors', async () => {
			mockClient.listTags.mockRejectedValueOnce(new Error('Server error'));

			await expect(api.getTags()).rejects.toThrow('Server error');
		});
	});

	// -----------------------------------------------------------------------
	// Experimental warning
	// -----------------------------------------------------------------------

	describe('experimental warning', () => {
		it('logs a console.warn on first API call (fresh module)', async () => {
			// Reset modules to clear the module-level experimentalWarningShown flag
			vi.resetModules();
			const { createLumenAPI: freshCreate } = await import('../src/dataview-api');
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			const freshClient = createMockApiClient();
			const freshApi = freshCreate(freshClient as any);
			await freshApi.search('test');

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining('EXPERIMENTAL'),
			);
		});

		it('logs warning only once across multiple calls (fresh module)', async () => {
			vi.resetModules();
			const { createLumenAPI: freshCreate } = await import('../src/dataview-api');
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			const freshClient = createMockApiClient();
			const freshApi = freshCreate(freshClient as any);

			await freshApi.search('test1');
			await freshApi.getSimilar('test.md');
			await freshApi.getTags();

			// The warning should fire exactly once despite multiple API calls
			const experimentalCalls = warnSpy.mock.calls.filter(
				([msg]) => typeof msg === 'string' && msg.includes('EXPERIMENTAL'),
			);
			expect(experimentalCalls).toHaveLength(1);
		});
	});
});
