/**
 * Chat Client for Lumen Conversations API.
 *
 * Handles conversation CRUD, real-time SSE streaming, workspace plan caching,
 * and typed error handling (403/429).
 *
 * CRUD operations use Obsidian's `requestUrl` (CORS-safe in Electron).
 * Message streaming uses Node's `https` module (accessed via Electron's
 * global `require` on desktop) for real-time token delivery. Falls back
 * to `requestUrl` (non-streaming) on mobile or if Node APIs are unavailable.
 *
 * Note: Obsidian's plugin sandbox injects a custom `require` that only
 * resolves known modules (obsidian, electron, codemirror). Static imports
 * of Node built-ins like `https` resolve to empty modules at runtime.
 * We use `globalThis.require` to access Electron's real Node.js require.
 * Native `fetch` is CORS-blocked in Electron — only `requestUrl` (main
 * process) and Node `https` bypass this restriction.
 */

import { requestUrl } from 'obsidian';
import type * as https from 'https';
import type {
	ChatSource,
	ChatStreamResult,
	ConversationListResponse,
	ConversationWithMessages,
	PlanTier,
	StreamMetadata,
	WorkspacePlanInfo,
} from './types';
import { PlanUpgradeRequiredError, RateLimitExceededError } from './types';
import { LumenHttpClient } from './http-client';
import { SSEStreamParser, parseSSEChunk, parseConversationSSE } from './utils/sse-parser';
import { logger } from './utils/logger';

/** Plan cache TTL: 5 minutes */
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000;

export class ChatClient extends LumenHttpClient {
	private workspaceId: string;
	private planCache: WorkspacePlanInfo | null = null;

	constructor(apiKey: string, workspaceId: string, serverUrl = '') {
		super(apiKey, serverUrl);
		this.workspaceId = workspaceId;
	}

	/** Update connection settings (e.g., after settings change) */
	updateSettings(apiKey: string, workspaceId: string, serverUrl = ''): void {
		this.apiKey = apiKey;
		this.workspaceId = workspaceId;
		this.serverUrl = serverUrl;
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

	/** Get a conversation with its full message history */
	async getConversation(id: string): Promise<ConversationWithMessages> {
		const response = await requestUrl({
			url: `${this.baseUrl}/api/conversations/${id}`,
			method: 'GET',
			headers: this.headers,
		});
		return response.json as ConversationWithMessages;
	}

	// -----------------------------------------------------------------------
	// Send Message (SSE streaming)
	// -----------------------------------------------------------------------

	/**
	 * Send a message with real-time SSE streaming.
	 *
	 * On desktop: uses Node's `https` module for incremental token delivery.
	 * On mobile/fallback: uses Obsidian's `requestUrl` (non-streaming — tokens
	 * arrive all at once when the response completes).
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
			onToolStart?: (tool: { id: string; name: string }) => void;
			onToolComplete?: (id: string) => void;
			onThinking?: (type: string) => void;
			signal?: AbortSignal;
		} = {},
	): Promise<ChatStreamResult> {
		const url = `${this.baseUrl}/api/conversations/${conversationId}/messages`;
		const parsedUrl = new URL(url);
		const transport = this.resolveNodeTransport(parsedUrl.protocol);

		if (transport) {
			return this.sendMessageStreaming(url, parsedUrl, transport, message, options);
		}

		// Fallback: requestUrl (non-streaming)
		logger.info(`Chat → POST ${url} (non-streaming fallback, deep_research: ${options.deepResearch ?? false})`);
		return this.sendMessageFallback(url, message, options);
	}

	/**
	 * Resolve Node's http/https.request function at runtime.
	 *
	 * Obsidian's plugin loader injects a custom `require` that only resolves
	 * known modules. `globalThis.require` accesses Electron's real Node.js
	 * require, which correctly resolves built-in modules like `https`.
	 * Returns null on mobile or when Node APIs are unavailable.
	 */
	private resolveNodeTransport(protocol: string): typeof https.request | null {
		const moduleName = protocol === 'https:' ? 'https' : 'http';
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const nodeRequire = (globalThis as any).require;
			if (typeof nodeRequire !== 'function') return null;
			const mod = nodeRequire(moduleName) as typeof import('https');
			if (typeof mod?.request === 'function') {
				logger.debug(`Node ${moduleName}.request resolved via globalThis.require`);
				return mod.request;
			}
		} catch {
			// Node modules not available (mobile environment)
		}
		logger.debug(`Node ${moduleName}.request not available`);
		return null;
	}

	/**
	 * Streaming path: Node's https/http module for incremental SSE delivery.
	 */
	private sendMessageStreaming(
		url: string,
		parsedUrl: URL,
		transport: typeof https.request,
		message: string,
		options: {
			deepResearch?: boolean;
			onToken?: (token: string) => void;
			onToolStart?: (tool: { id: string; name: string }) => void;
			onToolComplete?: (id: string) => void;
			onThinking?: (type: string) => void;
			signal?: AbortSignal;
		},
	): Promise<ChatStreamResult> {
		logger.info(`Chat → POST ${url} (streaming, deep_research: ${options.deepResearch ?? false})`);

		const startMs = Date.now();
		const payload = JSON.stringify({
			message,
			deep_research: options.deepResearch ?? false,
		});

		return new Promise<ChatStreamResult>((resolve, reject) => {
			const req = transport(
				{
					hostname: parsedUrl.hostname,
					port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
					path: parsedUrl.pathname + parsedUrl.search,
					method: 'POST',
					headers: {
						...this.headers,
						'Content-Length': new TextEncoder().encode(payload).byteLength,
					},
				},
				(res) => {
					const status = res.statusCode ?? 0;
					logger.info(`Chat response: ${status} in ${Date.now() - startMs}ms`);

					// Collect error response body for non-2xx
					if (status < 200 || status >= 300) {
						let errorBody = '';
						res.on('data', (chunk: string) => { errorBody += String(chunk); });
						res.on('end', () => {
							try {
								this.handleHttpError(status, errorBody);
							} catch (err) {
								reject(err);
							}
						});
						return;
					}

					// Stream SSE events
					let buffer = '';
					const sseParser = new SSEStreamParser();
					const tokens: string[] = [];
					let sources: ChatSource[] = [];
					let metadata: StreamMetadata | null = null;
					const errors: string[] = [];

					res.setEncoding('utf8');
					res.on('data', (chunk: string) => {
						buffer += chunk;

						const { events, remaining } = sseParser.parse(buffer);
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
							if (event.toolStart) {
								options.onToolStart?.(event.toolStart);
							}
							if (event.toolComplete) {
								options.onToolComplete?.(event.toolComplete);
							}
							if (event.thinking) {
								options.onThinking?.(event.thinking.type);
							}
						}
					});

					res.on('end', () => {
						for (const errMsg of errors) {
							logger.warn(`Chat SSE error: ${errMsg}`);
						}
						const content = tokens.join('');
						logger.info(`Chat complete: ${content.length} chars, ${sources.length} sources, ${Date.now() - startMs}ms total`);
						resolve({ content, sources, metadata });
					});

					res.on('error', (err) => {
						logger.error(`Chat stream error: ${err.message}`);
						reject(err);
					});
				},
			);

			req.on('error', (err) => {
				logger.error(`Chat request error: ${err.message}`);
				reject(err);
			});

			// AbortSignal support
			if (options.signal) {
				if (options.signal.aborted) {
					req.destroy();
					const abortErr = new Error('The operation was aborted');
					abortErr.name = 'AbortError';
					reject(abortErr);
					return;
				}
				options.signal.addEventListener('abort', () => {
					req.destroy();
					logger.info('Chat request aborted by user');
					const abortErr = new Error('The operation was aborted');
					abortErr.name = 'AbortError';
					reject(abortErr);
				}, { once: true });
			}

			req.write(payload);
			req.end();
		});
	}

	/**
	 * Non-streaming fallback: requestUrl waits for the full SSE response,
	 * then parses all events and emits tokens via onToken callback.
	 */
	private async sendMessageFallback(
		url: string,
		message: string,
		options: {
			deepResearch?: boolean;
			onToken?: (token: string) => void;
			signal?: AbortSignal;
		},
	): Promise<ChatStreamResult> {
		const startMs = Date.now();

		if (options.signal?.aborted) {
			const abortErr = new Error('The operation was aborted');
			abortErr.name = 'AbortError';
			throw abortErr;
		}

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

			const status = response.status;
			logger.info(`Chat response: ${status} in ${Date.now() - startMs}ms`);

			if (status < 200 || status >= 300) {
				this.handleHttpError(status, response.text);
			}

			// Parse the complete SSE response
			const result = parseConversationSSE(response.text);

			// Emit tokens via callback (all at once, since requestUrl is non-streaming)
			if (options.onToken) {
				for (const token of result.tokens) {
					options.onToken(token);
				}
			}

			for (const errMsg of result.errors) {
				logger.warn(`Chat SSE error: ${errMsg}`);
			}

			const content = result.tokens.join('');
			logger.info(`Chat complete (fallback): ${content.length} chars, ${result.sources.length} sources, ${Date.now() - startMs}ms total`);
			return { content, sources: result.sources, metadata: result.metadata };
		} catch (err) {
			// requestUrl throws on HTTP errors — extract status if available
			if (err instanceof Error && 'status' in err) {
				const status = (err as Error & { status: number }).status;
				const text = 'text' in err ? String((err as Error & { text: string }).text) : err.message;
				this.handleHttpError(status, text);
			}
			throw err;
		}
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
			const errorCode = (body['error'] as string)?.toLowerCase().replace(/\s+/g, '_') ?? '';
			if (errorCode === 'plan_upgrade_required') {
				const requiredPlan = (body['required_plan'] as string) ?? 'free';
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
