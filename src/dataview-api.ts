/**
 * Dataview Integration — Public JS API for Lumen
 *
 * EXPERIMENTAL: This API is subject to change in future releases.
 * Access via `app.plugins.plugins['lumen-search'].api` from Dataview JS blocks.
 *
 * Example usage in a Dataview JS block:
 *   const lumen = app.plugins.plugins['lumen-search'].api;
 *   const results = await lumen.search("machine learning", { limit: 5 });
 *   dv.list(results.map(r => r.source_path));
 */

import type { ApiClient } from './api-client';
import type { SearchResult } from './types';

export interface LumenSearchAPI {
	/** Semantic search across the vault */
	search(query: string, options?: { limit?: number; tags?: string[] }): Promise<SearchResult[]>;
	/** Find documents similar to a given document path */
	getSimilar(documentPath: string, options?: { limit?: number }): Promise<SearchResult[]>;
	/** Get all tags with document counts */
	getTags(): Promise<Array<{ tag: string; count: number }>>;
	/** API version string */
	version: string;
}

const API_VERSION = '1.3.0';

let experimentalWarningShown = false;

export function createLumenAPI(apiClient: ApiClient): LumenSearchAPI {
	function warnExperimental(): void {
		if (!experimentalWarningShown) {
			console.warn(
				'[Lumen] The Dataview JS API is EXPERIMENTAL and may change in future releases.',
			);
			experimentalWarningShown = true;
		}
	}

	return {
		version: API_VERSION,

		async search(query, options = {}) {
			warnExperimental();
			return apiClient.semanticSearch(query, {
				limit: options.limit,
				tags: options.tags,
			});
		},

		async getSimilar(documentPath, options = {}) {
			warnExperimental();
			return apiClient.searchSimilarDocuments(documentPath, {
				limit: options.limit,
			});
		},

		async getTags() {
			warnExperimental();
			return apiClient.listTags();
		},
	};
}
