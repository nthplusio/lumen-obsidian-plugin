/**
 * API Client for Lumen
 *
 * Direct REST client that calls Lumen HTTP endpoints.
 * Uses Obsidian's requestUrl for proper CORS handling in Electron.
 */

import { requestUrl } from 'obsidian';
import type { SearchResult, ServerStatus, DocumentContext, SimilarDocumentOptions } from './types';
import { LumenHttpClient } from './http-client';

/**
 * REST API client bound to an API key.
 *
 * The server URL defaults to LUMEN_API_URL but can be overridden
 * for staging/dev environments.
 */
export class ApiClient extends LumenHttpClient {
	constructor(apiKey: string, serverUrl = '') {
		super(apiKey, serverUrl);
	}

	/** Update settings (e.g., after settings change) */
	updateSettings(apiKey: string, serverUrl = ''): void {
		this.apiKey = apiKey;
		this.serverUrl = serverUrl;
	}

	/** Test connectivity and verify the API key is valid */
	async testConnection(): Promise<ServerStatus> {
		const response = await requestUrl({
			url: `${this.baseUrl}/health`,
			method: 'GET',
			headers: this.headers,
		});

		// /health may not validate auth — hit an authenticated endpoint
		// to confirm the API key is accepted by the server
		await requestUrl({
			url: `${this.baseUrl}/api/tags`,
			method: 'GET',
			headers: this.headers,
		});

		return response.json as ServerStatus;
	}

	/** Semantic search across the vault */
	async semanticSearch(
		query: string,
		options: {
			limit?: number;
			tags?: string[];
			dateAfter?: string;
			dateBefore?: string;
			folder?: string;
			fileType?: string;
			hasLinks?: boolean;
			hybrid?: boolean;
			bm25_weight?: number;
		} = {}
	): Promise<SearchResult[]> {
		const body: Record<string, unknown> = { query };
		if (options.limit !== undefined) body['limit'] = options.limit;
		if (options.tags?.length) body['tags'] = options.tags;
		if (options.dateAfter) body['date_after'] = options.dateAfter;
		if (options.dateBefore) body['date_before'] = options.dateBefore;
		if (options.folder) body['folder'] = options.folder;
		if (options.fileType) body['file_type'] = options.fileType;
		if (options.hasLinks !== undefined) body['has_links'] = options.hasLinks;
		if (options.hybrid) body['hybrid'] = true;
		if (options.bm25_weight !== undefined) body['bm25_weight'] = options.bm25_weight;

		const response = await requestUrl({
			url: `${this.baseUrl}/api/search`,
			method: 'POST',
			headers: this.headers,
			body: JSON.stringify(body),
		});
		return response.json as SearchResult[];
	}

	/** Get full document content (returns raw markdown) */
	async getDocumentContent(path: string): Promise<string> {
		const response = await requestUrl({
			url: `${this.baseUrl}/api/search/content/${encodeURIComponent(path)}`,
			method: 'GET',
			headers: this.headers,
		});
		return response.text;
	}

	/** Get document context (metadata, links, sections) */
	async getDocumentContext(path: string): Promise<DocumentContext> {
		const response = await requestUrl({
			url: `${this.baseUrl}/api/search/context/${encodeURIComponent(path)}`,
			method: 'GET',
			headers: this.headers,
		});
		const raw = response.json as Record<string, unknown>;
		return {
			path: raw['path'] as string,
			title: raw['title'] as string,
			frontmatter: (raw['frontmatter'] as Record<string, unknown>) ?? {},
			outgoingLinks: (raw['outgoing_links'] as string[]) ?? [],
			incomingLinks: (raw['incoming_links'] as string[]) ?? [],
			relatedDocuments: raw['related_documents'] as DocumentContext['relatedDocuments'],
			sections: (raw['sections'] as DocumentContext['sections']) ?? [],
		};
	}

	/** Find documents similar to a given document */
	async searchSimilarDocuments(
		documentPath: string,
		options: SimilarDocumentOptions = {},
	): Promise<SearchResult[]> {
		const body: Record<string, unknown> = { document_path: documentPath };
		if (options.limit !== undefined) body['limit'] = options.limit;

		const response = await requestUrl({
			url: `${this.baseUrl}/api/search/similar`,
			method: 'POST',
			headers: this.headers,
			body: JSON.stringify(body),
		});
		return response.json as SearchResult[];
	}

	/** Get all tags with document counts */
	async listTags(): Promise<Array<{ tag: string; count: number }>> {
		const response = await requestUrl({
			url: `${this.baseUrl}/api/tags`,
			method: 'GET',
			headers: this.headers,
		});
		return response.json as Array<{ tag: string; count: number }>;
	}
}
