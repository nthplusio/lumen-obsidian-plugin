/**
 * Chat Client for Lumen Conversations API.
 *
 * Handles conversation CRUD, buffered SSE message streaming with token replay,
 * workspace plan caching, and typed error handling (403/429).
 *
 * Uses Obsidian's `requestUrl` for all HTTP calls (CORS-safe in Electron).
 * `requestUrl` buffers the full response, so tokens are replayed via callback
 * after the server finishes generating.
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
import { parseConversationSSE } from './utils/sse-parser';
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
	// Send Message (buffered SSE)
	// -----------------------------------------------------------------------

	/**
	 * Send a message to a conversation and receive the response via buffered SSE.
	 *
	 * Since `requestUrl` buffers the entire response, this blocks until the
	 * server finishes generating. Tokens are then replayed via the `onToken`
	 * callback for progressive UI rendering.
	 *
	 * @param conversationId The conversation to send to
	 * @param message The user's message
	 * @param options.deepResearch Enable deep research mode
	 * @param options.onToken Called for each content token (replayed after buffer completes)
	 * @returns Complete response with content, sources, and metadata
	 */
	async sendMessage(
		conversationId: string,
		message: string,
		options: { deepResearch?: boolean; onToken?: (token: string) => void } = {},
	): Promise<ChatStreamResult> {
		const url = `${this.baseUrl}/api/conversations/${conversationId}/messages`;
		logger.info(`Chat → POST ${url} (deep_research: ${options.deepResearch ?? false})`);

		let responseText: string;
		try {
			const response = await requestUrl({
				url,
				method: 'POST',
				headers: this.headers,
				body: JSON.stringify({
					message,
					deep_research: options.deepResearch ?? false,
				}),
			});
			responseText = response.text;
			logger.info(`Chat response: ${response.status}, ${responseText.length} bytes`);
		} catch (err: unknown) {
			this.handleHttpError(err);
			throw err; // unreachable, handleHttpError always throws or re-throws
		}

		// Parse the buffered SSE response
		const parseResult = parseConversationSSE(
			responseText.endsWith('\n') ? responseText : responseText + '\n',
		);

		// Log any SSE-level errors
		for (const errMsg of parseResult.errors) {
			logger.warn(`Chat SSE error: ${errMsg}`);
		}

		// Replay tokens via callback
		let fullContent = '';
		for (const token of parseResult.tokens) {
			fullContent += token;
			options.onToken?.(token);
		}

		const sources: ChatSource[] = parseResult.sources;
		const metadata: StreamMetadata | null = parseResult.metadata;

		logger.info(`Chat complete: ${fullContent.length} chars, ${sources.length} sources`);
		return { content: fullContent, sources, metadata };
	}

	// -----------------------------------------------------------------------
	// Error handling
	// -----------------------------------------------------------------------

	/**
	 * Parse and throw typed errors for HTTP failures.
	 *
	 * requestUrl throws an object with { status, text, json } for HTTP errors.
	 */
	private handleHttpError(err: unknown): never {
		const httpErr = err as { status?: number; text?: string; json?: Record<string, unknown> };

		if (httpErr.status === 403) {
			const body = httpErr.json ?? {};
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

		if (httpErr.status === 429) {
			const body = httpErr.json ?? {};
			if (body['error'] === 'rate_limit_exceeded') {
				const msg = (body['message'] as string) ?? 'Rate limit exceeded.';
				const limit = (body['limit'] as number) ?? 0;
				const remaining = (body['remaining'] as number) ?? 0;
				const resetsAt = (body['resets_at'] as string) ?? '';
				logger.warn(`Chat 429: ${msg} (resets at ${resetsAt})`);
				throw new RateLimitExceededError(msg, limit, remaining, resetsAt);
			}
			const msg = (body['message'] as string) ?? 'Rate limit exceeded.';
			logger.warn(`Chat 429: ${msg}`);
			throw new RateLimitExceededError(msg, 0, 0, '');
		}

		const msg = err instanceof Error ? err.message : String(err);
		logger.error(`Chat request failed: ${httpErr.status ?? 'network'} — ${msg}`);
		throw err;
	}
}
