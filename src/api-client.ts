/**
 * API Client for Lumen
 *
 * Direct REST client that calls Lumen HTTP endpoints.
 * Uses Obsidian's requestUrl for proper CORS handling in Electron.
 */

import { requestUrl } from 'obsidian';
import type { ChatResponse, SearchResult, ServerStatus, DocumentContext, SimilarDocumentOptions } from './types';

/**
 * REST API client bound to specific credentials.
 *
 * Created once with apiUrl + apiKey, then used to call individual endpoints.
 */
export class ApiClient {
	constructor(
		private apiUrl: string,
		private apiKey: string,
	) {}

	/** Normalize base URL (strip trailing slashes) */
	private get baseUrl(): string {
		return this.apiUrl.replace(/\/+$/, '');
	}

	/** Common headers for authenticated requests */
	private get headers(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			'X-API-Key': this.apiKey,
		};
	}

	/** Update connection settings (e.g., after settings change) */
	updateSettings(apiUrl: string, apiKey: string): void {
		this.apiUrl = apiUrl;
		this.apiKey = apiKey;
	}

	/** Test connectivity by calling GET /health */
	async testConnection(): Promise<ServerStatus> {
		const response = await requestUrl({
			url: `${this.baseUrl}/health`,
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
			dateFrom?: string;
			dateTo?: string;
			hybrid?: boolean;
			bm25_weight?: number;
		} = {}
	): Promise<SearchResult[]> {
		const body: Record<string, unknown> = { query };
		if (options.limit !== undefined) body['limit'] = options.limit;
		if (options.tags?.length) body['tags'] = options.tags;
		if (options.dateFrom) body['date_from'] = options.dateFrom;
		if (options.dateTo) body['date_to'] = options.dateTo;
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
		return response.json as DocumentContext;
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

	/** Chat with the vault (stub — returns placeholder until backend is ready) */
	async chat(
		_message: string,
		_options: { conversation_id?: string } = {},
	): Promise<ChatResponse> {
		// TODO: Replace with POST /api/chat when backend is implemented
		return {
			content: 'Chat functionality is coming soon. Use the Search tab to find notes in your vault.',
			sources: [],
		};
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

/** @deprecated Use ApiClient instead */
export const McpClient = ApiClient;
