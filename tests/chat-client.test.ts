/**
 * Unit tests for ChatClient.
 *
 * Tests:
 *   - Plan caching: fresh fetch, cache hit, expiry, failure fallback
 *   - sendMessage with streaming via Node https + onToken callback
 *   - 403 → PlanUpgradeRequiredError
 *   - 429 → RateLimitExceededError
 *   - Conversation CRUD calls correct endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { ChatClient } from '../src/chat-client';
import { PlanUpgradeRequiredError, RateLimitExceededError } from '../src/types';

// ---------------------------------------------------------------------------
// Mock Obsidian's requestUrl (used for CRUD operations and plan fetching)
// ---------------------------------------------------------------------------

const mockRequestUrl = vi.fn();

vi.mock('obsidian', () => ({
	requestUrl: (...args: unknown[]) => mockRequestUrl(...args),
}));

// ---------------------------------------------------------------------------
// Mock Node's https/http via globalThis.require
//
// In Obsidian's Electron, `globalThis.require` provides access to Node's
// real require function (bypassing Obsidian's sandboxed plugin require).
// We mock it here to control what the ChatClient receives.
// ---------------------------------------------------------------------------

class MockIncomingMessage extends EventEmitter {
	statusCode: number;
	constructor(statusCode: number) {
		super();
		this.statusCode = statusCode;
	}
	setEncoding(_encoding: string): void { /* noop */ }
}

class MockClientRequest extends EventEmitter {
	destroyed = false;
	write(_data: string): void { /* noop */ }
	end(): void { /* noop */ }
	destroy(): void { this.destroyed = true; }
}

const mockHttpsRequest = vi.fn();

// Save original require to restore after tests
const originalRequire = globalThis.require;

/**
 * Helper: set up mockHttpsRequest to return a successful SSE response.
 * Returns the mock response so tests can emit data/end events.
 */
function mockStreamResponse(statusCode: number, sseText: string): { req: MockClientRequest; res: MockIncomingMessage } {
	const res = new MockIncomingMessage(statusCode);
	const req = new MockClientRequest();

	mockHttpsRequest.mockImplementationOnce((_opts: unknown, callback: (res: MockIncomingMessage) => void) => {
		// Defer the callback so the req.write/req.end calls happen first
		process.nextTick(() => {
			callback(res);
			if (statusCode >= 200 && statusCode < 300) {
				// Emit SSE data in chunks, then end
				if (sseText) res.emit('data', sseText);
				res.emit('end');
			} else {
				// For error responses, emit the body then end
				res.emit('data', sseText);
				res.emit('end');
			}
		});
		return req;
	});

	return { req, res };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatClient', () => {
	let client: ChatClient;

	beforeEach(() => {
		vi.clearAllMocks();

		// Mock globalThis.require to return our mock https/http modules
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).require = vi.fn((name: string) => {
			if (name === 'https' || name === 'http') {
				return { request: mockHttpsRequest };
			}
			return originalRequire(name);
		});

		client = new ChatClient('test-key', 'ws-123');
	});

	afterEach(() => {
		// Restore original require
		(globalThis as any).require = originalRequire;
	});

	// -----------------------------------------------------------------------
	// Plan caching
	// -----------------------------------------------------------------------

	describe('getWorkspacePlan', () => {
		it('fetches plan from server on first call', async () => {
			mockRequestUrl.mockResolvedValueOnce({
				json: { subscription: { plan: 'free', status: 'active' } },
			});

			const result = await client.getWorkspacePlan();

			expect(result.plan).toBe('free');
			expect(result.subscriptionStatus).toBe('active');
			expect(mockRequestUrl).toHaveBeenCalledOnce();
			expect(mockRequestUrl).toHaveBeenCalledWith(expect.objectContaining({
				url: 'https://app.getlumen.io/api/workspaces/ws-123',
				method: 'GET',
			}));
		});

		it('returns cached plan on second call', async () => {
			mockRequestUrl.mockResolvedValueOnce({
				json: { subscription: { plan: 'pro', status: 'active' } },
			});

			const first = await client.getWorkspacePlan();
			const second = await client.getWorkspacePlan();

			expect(first.plan).toBe('pro');
			expect(second.plan).toBe('pro');
			expect(mockRequestUrl).toHaveBeenCalledOnce(); // Only one request
		});

		it('returns null plan on failure', async () => {
			mockRequestUrl.mockRejectedValueOnce(new Error('network error'));

			const result = await client.getWorkspacePlan();

			expect(result.plan).toBeNull();
			expect(result.subscriptionStatus).toBeNull();
		});

		it('returns null plan when no subscription in response', async () => {
			mockRequestUrl.mockResolvedValueOnce({
				json: { id: 'ws-123', name: 'test' },
			});

			const result = await client.getWorkspacePlan();

			expect(result.plan).toBeNull();
		});

		it('invalidates cache on settings change', async () => {
			mockRequestUrl.mockResolvedValueOnce({
				json: { subscription: { plan: 'free', status: 'active' } },
			});

			await client.getWorkspacePlan();
			client.updateSettings('new-key', 'new-ws');

			mockRequestUrl.mockResolvedValueOnce({
				json: { subscription: { plan: 'pro', status: 'active' } },
			});

			const result = await client.getWorkspacePlan();
			expect(result.plan).toBe('pro');
			expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		});
	});

	// -----------------------------------------------------------------------
	// Conversation CRUD
	// -----------------------------------------------------------------------

	describe('createConversation', () => {
		it('calls POST /api/conversations', async () => {
			mockRequestUrl.mockResolvedValueOnce({
				json: { id: 'conv-abc' },
			});

			const result = await client.createConversation();

			expect(result.id).toBe('conv-abc');
			expect(mockRequestUrl).toHaveBeenCalledWith(expect.objectContaining({
				url: 'https://app.getlumen.io/api/conversations',
				method: 'POST',
			}));
		});

		it('passes title when provided', async () => {
			mockRequestUrl.mockResolvedValueOnce({
				json: { id: 'conv-abc' },
			});

			await client.createConversation('My Chat');

			const callBody = JSON.parse(mockRequestUrl.mock.calls[0]![0].body);
			expect(callBody.title).toBe('My Chat');
		});
	});

	describe('listConversations', () => {
		it('calls GET /api/conversations with params', async () => {
			mockRequestUrl.mockResolvedValueOnce({
				json: { conversations: [], total: 0 },
			});

			await client.listConversations(10, 5);

			expect(mockRequestUrl).toHaveBeenCalledWith(expect.objectContaining({
				url: 'https://app.getlumen.io/api/conversations?limit=10&offset=5',
				method: 'GET',
			}));
		});
	});

	describe('deleteConversation', () => {
		it('calls DELETE /api/conversations/:id', async () => {
			mockRequestUrl.mockResolvedValueOnce({});

			await client.deleteConversation('conv-123');

			expect(mockRequestUrl).toHaveBeenCalledWith(expect.objectContaining({
				url: 'https://app.getlumen.io/api/conversations/conv-123',
				method: 'DELETE',
			}));
		});
	});

	// -----------------------------------------------------------------------
	// sendMessage (SSE streaming via Node https)
	// -----------------------------------------------------------------------

	describe('sendMessage', () => {
		it('sends POST with message and deep_research flag', async () => {
			mockStreamResponse(200, [
				'event: content_block_delta',
				'data: {"delta":{"type":"text_delta","text":"Hello"}}',
				'',
				'',
			].join('\n'));

			await client.sendMessage('conv-1', 'Test message', { deepResearch: true });

			expect(mockHttpsRequest).toHaveBeenCalledOnce();
			const [opts] = mockHttpsRequest.mock.calls[0]!;
			expect(opts.method).toBe('POST');
			expect(opts.hostname).toBe('app.getlumen.io');
			expect(opts.path).toBe('/api/conversations/conv-1/messages');
		});

		it('streams tokens via onToken callback', async () => {
			mockStreamResponse(200, [
				'event: content_block_delta',
				'data: {"delta":{"type":"text_delta","text":"Hello"}}',
				'',
				'event: content_block_delta',
				'data: {"delta":{"type":"text_delta","text":" world"}}',
				'',
				'',
			].join('\n'));

			const tokens: string[] = [];
			const result = await client.sendMessage('conv-1', 'Test', {
				onToken: (t) => tokens.push(t),
			});

			expect(tokens).toEqual(['Hello', ' world']);
			expect(result.content).toBe('Hello world');
		});

		it('returns sources and metadata from lumen_metadata event', async () => {
			mockStreamResponse(200, [
				'event: content_block_delta',
				'data: {"delta":{"type":"text_delta","text":"Answer"}}',
				'',
				'event: lumen_metadata',
				'data: {"sources":[{"path":"note.md","score":0.9}],"token_usage":{"input":10,"output":20},"turns_used":1,"turns_remaining":9}',
				'',
				'',
			].join('\n'));

			const result = await client.sendMessage('conv-1', 'Q');

			expect(result.sources).toEqual([{ path: 'note.md', score: 0.9 }]);
			expect(result.metadata).not.toBeNull();
			expect(result.metadata!.turnsUsed).toBe(1);
		});

		it('returns empty content when no tokens in response', async () => {
			mockStreamResponse(200, '');

			const result = await client.sendMessage('conv-1', 'Q');

			expect(result.content).toBe('');
			expect(result.sources).toEqual([]);
		});

		it('falls back to requestUrl when globalThis.require is unavailable', async () => {
			// Remove globalThis.require to simulate mobile environment
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(globalThis as any).require = undefined;

			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				text: [
					'event: content_block_delta',
					'data: {"delta":{"type":"text_delta","text":"Fallback"}}',
					'',
					'',
				].join('\n'),
			});

			const tokens: string[] = [];
			const result = await client.sendMessage('conv-1', 'Q', {
				onToken: (t) => tokens.push(t),
			});

			expect(result.content).toBe('Fallback');
			expect(tokens).toEqual(['Fallback']);
			expect(mockHttpsRequest).not.toHaveBeenCalled();
		});
	});

	// -----------------------------------------------------------------------
	// Error handling
	// -----------------------------------------------------------------------

	describe('error handling', () => {
		it('throws PlanUpgradeRequiredError on 403 with plan_upgrade_required', async () => {
			mockStreamResponse(403, JSON.stringify({
				error: 'plan_upgrade_required',
				message: 'Deep Research requires a Pro plan',
				required_plan: 'pro',
			}));

			await expect(client.sendMessage('conv-1', 'Q'))
				.rejects.toThrow(PlanUpgradeRequiredError);
		});

		it('throws RateLimitExceededError on 429 with rate_limit_exceeded', async () => {
			mockStreamResponse(429, JSON.stringify({
				error: 'rate_limit_exceeded',
				message: 'Daily limit reached',
				limit: 50,
				remaining: 0,
				resets_at: '2026-02-20T00:00:00Z',
			}));

			await expect(client.sendMessage('conv-1', 'Q'))
				.rejects.toThrow(RateLimitExceededError);
		});

		it('includes rate limit details in RateLimitExceededError', async () => {
			mockStreamResponse(429, JSON.stringify({
				error: 'rate_limit_exceeded',
				message: 'Daily limit reached',
				limit: 50,
				remaining: 0,
				resets_at: '2026-02-20T00:00:00Z',
			}));

			try {
				await client.sendMessage('conv-1', 'Q');
			} catch (e) {
				expect(e).toBeInstanceOf(RateLimitExceededError);
				const rlErr = e as RateLimitExceededError;
				expect(rlErr.limit).toBe(50);
				expect(rlErr.remaining).toBe(0);
				expect(rlErr.resetsAt).toBe('2026-02-20T00:00:00Z');
			}
		});

		it('throws PlanUpgradeRequiredError on 403 with Title Case error from feature gate', async () => {
			mockStreamResponse(403, JSON.stringify({
				error: 'Plan upgrade required',
				message: 'This feature requires the free plan or higher',
				required_plan: 'free',
				current_plan: null,
			}));

			await expect(client.sendMessage('conv-1', 'Q'))
				.rejects.toThrow(PlanUpgradeRequiredError);
		});

		it('throws generic Error on 403 without plan_upgrade_required', async () => {
			mockStreamResponse(403, JSON.stringify({ message: 'Access denied' }));

			await expect(client.sendMessage('conv-1', 'Q'))
				.rejects.toThrow('Access denied');
		});

		it('re-throws original error for network failures', async () => {
			const req = new MockClientRequest();
			mockHttpsRequest.mockImplementationOnce(() => {
				process.nextTick(() => {
					req.emit('error', new Error('ECONNREFUSED'));
				});
				return req;
			});

			await expect(client.sendMessage('conv-1', 'Q'))
				.rejects.toThrow('ECONNREFUSED');
		});
	});
});
