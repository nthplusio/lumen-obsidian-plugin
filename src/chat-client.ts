/**
 * Chat Client for Lumen Conversations API.
 *
 * Handles conversation CRUD, real-time SSE streaming, workspace plan caching,
 * and typed error handling (403/429).
 *
 * CRUD operations use Obsidian's `requestUrl` (CORS-safe in Electron).
 * Message streaming uses native `fetch` with `ReadableStream` for real-time
 * token delivery — the server includes CORS headers on the hijacked SSE
 * response, so `fetch` works in Electron's renderer.
 */

import { requestUrl } from 'obsidian';
import type {
	ChatSource,
	ChatStreamResult,
	ConversationListResponse,
	PlanTier,
	StreamMetadata,
	WorkspacePlanInfo,
} from './types';
import { PlanUpgradeRequiredError, RateLimitExceededError } from './types';
import { LumenHttpClient } from './http-client';
import { parseSSEChunk } from './utils/sse-parser';
import { logger } from './utils/logger';

// Re-export error classes for backward compatibility
export { PlanUpgradeRequiredError, RateLimitExceededError };

/** Plan cache TTL: 5 minutes */
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000;

export class ChatClient extends LumenHttpClient {
	private workspaceId: string;
	private planCache: WorkspacePlanInfo | null = null;

	constructor(apiKey: string, workspaceId: string) {
		super(apiKey);
		this.workspaceId = workspaceId;
	}

	/** Update connection settings (e.g., after settings change) */
	updateSettings(apiKey: string, workspaceId: string): void {
		this.apiKey = apiKey;
		this.workspaceId = workspaceId;
		// Invalidate plan cache on settings change
		this.planCache = null;
	}

	// -----------------------------------------------------------------------
	// Plan / Subscription
	// -----------------------------------------------------------------------

	/**
	 * Get the workspace's subscription plan, with 5-minute caching.
	 * Returns { plan: null } on failure (non-blocking).
	 */
	async getWorkspacePlan(): Promise<WorkspacePlanInfo> {
		// Return cached if fresh
		if (this.planCache && Date.now() - this.planCache.cachedAt < PLAN_CACHE_TTL_MS) {
			return this.planCache;
		}

		try {
			const response = await requestUrl({
				url: `${this.baseUrl}/api/workspaces/${this.workspaceId}`,
				method: 'GET',
				headers: this.headers,
			});

			const body = response.json as Record<string, unknown>;
			const subscription = body['subscription'] as Record<string, unknown> | undefined;

			this.planCache = {
				plan: (subscription?.['plan'] as PlanTier) ?? null,
				subscriptionStatus: (subscription?.['status'] as string) ?? null,
				cachedAt: Date.now(),
			};

			logger.debug(`Plan fetched: ${this.planCache.plan ?? 'none'} (status: ${this.planCache.subscriptionStatus ?? 'none'})`);
			return this.planCache;
		} catch (err) {
			logger.debug(`Plan fetch failed: ${err instanceof Error ? err.message : String(err)}`);
			const fallback: WorkspacePlanInfo = {
				plan: null,
				subscriptionStatus: null,
				cachedAt: Date.now(),
			};
			this.planCache = fallback;
			return fallback;
		}
	}

	/** Invalidate the plan cache (e.g., after an upgrade) */
	invalidatePlanCache(): void {
		this.planCache = null;
	}

	// -----------------------------------------------------------------------
	// Conversation CRUD
	// -----------------------------------------------------------------------

	/** Create a new conversation */
	async createConversation(title?: string): Promise<{ id: string }> {
		const body: Record<string, unknown> = {};
		if (title) body['title'] = title;

		const response = await requestUrl({
			url: `${this.baseUrl}/api/conversations`,
			method: 'POST',
			headers: this.headers,
			body: JSON.stringify(body),
		});

		const result = response.json as { id: string };
		logger.info(`Conversation created: ${result.id}`);
		return result;
	}

	/** List recent conversations */
	async listConversations(limit = 20, offset = 0): Promise<ConversationListResponse> {
		const params = new URLSearchParams();
		params.set('limit', String(limit));
		params.set('offset', String(offset));

		const response = await requestUrl({
			url: `${this.baseUrl}/api/conversations?${params.toString()}`,
			method: 'GET',
			headers: this.headers,
		});

		return response.json as ConversationListResponse;
	}

	/** Delete a conversation */
	async deleteConversation(id: string): Promise<void> {
		await requestUrl({
			url: `${this.baseUrl}/api/conversations/${id}`,
			method: 'DELETE',
			headers: this.headers,
		});
		logger.info(`Conversation deleted: ${id}`);
	}

	// -----------------------------------------------------------------------
	// Send Message (real-time SSE streaming via fetch + ReadableStream)
	// -----------------------------------------------------------------------

	/**
	 * Send a message with real-time SSE streaming via fetch + ReadableStream.
	 *
	 * Tokens arrive incrementally via the `onToken` callback.
	 *
	 * @param conversationId Conversation to send to
	 * @param message User's message text
	 * @param options.deepResearch Enable deep research mode
	 * @param options.onToken Called for each content token AS IT ARRIVES
	 * @param options.signal AbortSignal for cancellation
	 * @returns Complete response with content, sources, and metadata
	 */
	async sendMessage(
		conversationId: string,
		message: string,
		options: {
			deepResearch?: boolean;
			onToken?: (token: string) => void;
			signal?: AbortSignal;
		} = {},
	): Promise<ChatStreamResult> {
		const url = `${this.baseUrl}/api/conversations/${conversationId}/messages`;
		logger.info(`Chat → POST ${url} (deep_research: ${options.deepResearch ?? false})`);

		const startMs = Date.now();
		const payload = JSON.stringify({
			message,
			deep_research: options.deepResearch ?? false,
		});

		const response = await fetch(url, {
			method: 'POST',
			headers: this.headers,
			body: payload,
			signal: options.signal,
		});

		const status = response.status;
		logger.info(`Chat response: ${status} in ${Date.now() - startMs}ms`);

		if (!response.ok) {
			const errorBody = await response.text();
			this.handleHttpError(status, errorBody);
		}

		// Stream SSE events from ReadableStream
		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('Response body is not readable');
		}

		const decoder = new TextDecoder('utf-8');
		let buffer = '';
		const tokens: string[] = [];
		let sources: ChatSource[] = [];
		let metadata: StreamMetadata | null = null;
		const errors: string[] = [];

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				const { events, remaining } = parseSSEChunk(buffer);
				buffer = remaining;

				for (const event of events) {
					if (event.token !== undefined) {
						tokens.push(event.token);
						options.onToken?.(event.token);
					}
					if (event.sources) {
						sources = event.sources;
					}
					if (event.metadata) {
						metadata = event.metadata;
					}
					if (event.error) {
						errors.push(event.error);
					}
				}
			}
		} finally {
			reader.releaseLock();
		}

		for (const errMsg of errors) {
			logger.warn(`Chat SSE error: ${errMsg}`);
		}
		const content = tokens.join('');
		logger.info(`Chat complete: ${content.length} chars, ${sources.length} sources, ${Date.now() - startMs}ms total`);
		return { content, sources, metadata };
	}

	// -----------------------------------------------------------------------
	// Error handling
	// -----------------------------------------------------------------------

	/**
	 * Handle HTTP error response.
	 *
	 * Parses the response body as JSON to extract structured error info
	 * for 403 (plan_upgrade_required) and 429 (rate_limit_exceeded).
	 */
	private handleHttpError(status: number, responseBody: string): never {
		let body: Record<string, unknown> = {};
		try {
			body = JSON.parse(responseBody) as Record<string, unknown>;
		} catch {
			// Response body may not be JSON
		}

		if (status === 403) {
			if (body['error'] === 'plan_upgrade_required') {
				const requiredPlan = (body['required_plan'] as string) ?? 'Plus';
				const msg = (body['message'] as string) ?? `This feature requires a ${requiredPlan} plan.`;
				logger.warn(`Chat 403: ${msg}`);
				throw new PlanUpgradeRequiredError(msg, requiredPlan);
			}
			const msg = (body['message'] as string) ?? 'Access denied.';
			logger.warn(`Chat 403: ${msg}`);
			throw new Error(msg);
		}

		if (status === 429) {
			const msg = (body['message'] as string) ?? 'Rate limit exceeded.';
			const limit = (body['limit'] as number) ?? 0;
			const remaining = (body['remaining'] as number) ?? 0;
			const resetsAt = (body['resets_at'] as string) ?? '';
			logger.warn(`Chat 429: ${msg} (resets at ${resetsAt})`);
			throw new RateLimitExceededError(msg, limit, remaining, resetsAt);
		}

		const msg = (body['message'] as string) ?? `HTTP ${status}`;
		logger.error(`Chat request failed: ${status} — ${msg}`);
		const error = new Error(msg);
		(error as Error & { status: number }).status = status;
		throw error;
	}
}
