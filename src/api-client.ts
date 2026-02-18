/**
 * API Client for Lumen
 *
 * Direct REST client that calls Lumen HTTP endpoints.
 * Uses Obsidian's requestUrl for proper CORS handling in Electron.
 */

import { requestUrl } from 'obsidian';
import type { ChatResponse, SearchResult, ServerStatus, DocumentContext, SimilarDocumentOptions } from './types';
import { parseSSEBuffer } from './utils/sse-parser';

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

	/**
	 * Stream a chat response via SSE.
	 * Uses native fetch (not requestUrl) for ReadableStream SSE consumption.
	 * @param onToken Called for each content token as it arrives
	 * @returns Completed response with full content and sources
	 */
	async chatStream(
		message: string,
		history: Array<{ role: string; content: string }>,
		onToken: (token: string) => void,
	): Promise<ChatResponse> {
		const response = await fetch(`${this.baseUrl}/api/chat`, {
			method: 'POST',
			headers: this.headers,
			body: JSON.stringify({ message, history }),
		});

		if (response.status === 403) {
			const body = await response.json().catch(() => ({}) as Record<string, unknown>) as Record<string, unknown>;
			const plan = (body['required_plan'] as string) ?? 'Plus';
			throw new Error(`AI Chat requires a ${plan} subscription. Upgrade in your Lumen dashboard.`);
		}

		if (!response.ok) {
			throw new Error(`Chat request failed: ${response.status} ${response.statusText}`);
		}

		const reader = response.body?.getReader();
		if (!reader) throw new Error('No response stream available');

		const decoder = new TextDecoder();
		let buffer = '';
		let fullContent = '';
		let finalSources: string[] = [];

		try {
			while (true) {
				const { done: streamDone, value } = await reader.read();
				if (streamDone) break;

				buffer += decoder.decode(value, { stream: true });
				const result = parseSSEBuffer(buffer);
				buffer = result.remaining;

				for (const token of result.tokens) {
					fullContent += token;
					onToken(token);
				}

				if (result.done) {
					finalSources = result.sources;
					break;
				}
			}
		} finally {
			reader.releaseLock();
		}

		return { content: fullContent, sources: finalSources };
	}

	/** Fetch chat history from the server */
	async chatHistory(options: { limit?: number; before?: string } = {}): Promise<{ messages: Array<{ id: string; role: string; content: string; sources: string[]; createdAt: string }> }> {
		const params = new URLSearchParams();
		if (options.limit !== undefined) params.set('limit', String(options.limit));
		if (options.before) params.set('before', options.before);

		const qs = params.toString();
		const response = await requestUrl({
			url: `${this.baseUrl}/api/chat/history${qs ? `?${qs}` : ''}`,
			method: 'GET',
			headers: this.headers,
		});
		return response.json as { messages: Array<{ id: string; role: string; content: string; sources: string[]; createdAt: string }> };
	}

	/** Clear all chat history on the server */
	async clearChatHistory(): Promise<void> {
		await requestUrl({
			url: `${this.baseUrl}/api/chat/history`,
			method: 'DELETE',
			headers: this.headers,
		});
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
