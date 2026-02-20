/**
 * API Client for Lumen
 *
 * Direct REST client that calls Lumen HTTP endpoints.
 * Uses Obsidian's requestUrl for proper CORS handling in Electron.
 */

import { requestUrl } from 'obsidian';
import type { ChatResponse, SearchResult, ServerStatus, DocumentContext, SimilarDocumentOptions } from './types';
import { LumenHttpClient } from './http-client';
import { parseSSEBuffer } from './utils/sse-parser';
import { logger } from './utils/logger';

/**
 * REST API client bound to specific credentials.
 *
 * Created once with apiUrl + apiKey, then used to call individual endpoints.
 */
export class ApiClient extends LumenHttpClient {
	constructor(apiUrl: string, apiKey: string) {
		super(apiUrl, apiKey);
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
	 * Chat with the vault via SSE (legacy /api/chat endpoint).
	 *
	 * @deprecated Use `ChatClient.sendMessage()` instead, which supports
	 * conversations, deep research, plan gating, and typed error handling.
	 *
	 * @param onToken Called for each content token parsed from the SSE response
	 * @returns Completed response with full content and sources
	 */
	async chatStream(
		message: string,
		history: Array<{ role: string; content: string }>,
		onToken: (token: string) => void,
	): Promise<ChatResponse> {
		const url = `${this.baseUrl}/api/chat`;
		logger.info(`Chat request → POST ${url} (history: ${history.length} messages)`);

		let responseText: string;
		try {
			const response = await requestUrl({
				url,
				method: 'POST',
				headers: this.headers,
				body: JSON.stringify({ message, history }),
			});
			responseText = response.text;
			logger.info(`Chat response: ${response.status}, ${responseText.length} bytes`);
		} catch (err: unknown) {
			// requestUrl throws for HTTP errors — extract status if available
			const httpErr = err as { status?: number; text?: string; json?: Record<string, unknown> };
			if (httpErr.status === 403) {
				const body = httpErr.json ?? {};
				const plan = (body['required_plan'] as string) ?? 'Plus';
				const msg = `AI Chat requires a ${plan} subscription. Upgrade in your Lumen dashboard.`;
				logger.warn(`Chat 403: ${msg}`);
				throw new Error(msg);
			}
			const msg = err instanceof Error ? err.message : String(err);
			logger.error(`Chat request failed: ${httpErr.status ?? 'network'} — ${msg}`);
			throw err;
		}

		// Parse all SSE events from the buffered response and replay tokens
		const parseResult = parseSSEBuffer(
			responseText.endsWith('\n') ? responseText : responseText + '\n',
		);

		let fullContent = '';
		for (const token of parseResult.tokens) {
			fullContent += token;
			onToken(token);
		}

		logger.info(`Chat complete: ${fullContent.length} chars, ${parseResult.sources.length} sources`);
		return { content: fullContent, sources: parseResult.sources };
	}

	/** @deprecated Use ChatClient with conversation API instead. */
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

	/** @deprecated Use ChatClient with conversation API instead. */
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
