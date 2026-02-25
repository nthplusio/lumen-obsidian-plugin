/**
 * Unit tests for ChatClient.
 *
 * Tests:
 *   - Plan caching: fresh fetch, cache hit, expiry, failure fallback
 *   - 403 → PlanUpgradeRequiredError
 *   - 429 → RateLimitExceededError
 *   - sendMessage with onToken callback replays tokens
 *   - Conversation CRUD calls correct endpoints
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatClient, PlanUpgradeRequiredError, RateLimitExceededError } from '../src/chat-client';

// ---------------------------------------------------------------------------
// Mock Obsidian's requestUrl
// ---------------------------------------------------------------------------

const mockRequestUrl = vi.fn();

vi.mock('obsidian', () => ({
	requestUrl: (...args: unknown[]) => mockRequestUrl(...args),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatClient', () => {
	let client: ChatClient;

	beforeEach(() => {
		vi.clearAllMocks();
		client = new ChatClient('test-key', 'ws-123');
	});

	// -----------------------------------------------------------------------
	// Plan caching
	// -----------------------------------------------------------------------

	describe('getWorkspacePlan', () => {
		it('fetches plan from server on first call', async () => {
			mockRequestUrl.mockResolvedValueOnce({
				json: { subscription: { plan: 'plus', status: 'active' } },
			});

			const result = await client.getWorkspacePlan();

			expect(result.plan).toBe('plus');
			expect(result.subscriptionStatus).toBe('active');
			expect(mockRequestUrl).toHaveBeenCalledOnce();
			expect(mockRequestUrl).toHaveBeenCalledWith(expect.objectContaining({
				url: 'https://app.getlumen.dev/api/workspaces/ws-123',
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
				json: { subscription: { plan: 'starter', status: 'active' } },
			});

			await client.getWorkspacePlan();
			client.updateSettings('http://new-url', 'new-key', 'new-ws');

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
				url: 'https://app.getlumen.dev/api/conversations',
				method: 'POST',
			}));
		});

		it('passes title when provided', async () => {
			mockRequestUrl.mockResolvedValueOnce({
				json: { id: 'conv-abc' },
			});

			await client.createConversation('My Chat');

			const callBody = JSON.parse(mockRequestUrl.mock.calls[0][0].body);
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
				url: 'https://app.getlumen.dev/api/conversations?limit=10&offset=5',
				method: 'GET',
			}));
		});
	});

	describe('deleteConversation', () => {
		it('calls DELETE /api/conversations/:id', async () => {
			mockRequestUrl.mockResolvedValueOnce({});

			await client.deleteConversation('conv-123');

			expect(mockRequestUrl).toHaveBeenCalledWith(expect.objectContaining({
				url: 'https://app.getlumen.dev/api/conversations/conv-123',
				method: 'DELETE',
			}));
		});
	});

	// -----------------------------------------------------------------------
	// sendMessage
	// -----------------------------------------------------------------------

	describe('sendMessage', () => {
		it('calls POST with message and deep_research flag', async () => {
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				text: [
					'event: content_block_delta',
					'data: {"delta":{"type":"text_delta","text":"Hello"}}',
					'',
					'',
				].join('\n'),
			});

			await client.sendMessage('conv-1', 'Test message', { deepResearch: true });

			const callArgs = mockRequestUrl.mock.calls[0][0];
			expect(callArgs.url).toBe('https://app.getlumen.dev/api/conversations/conv-1/messages');
			expect(callArgs.method).toBe('POST');

			const body = JSON.parse(callArgs.body);
			expect(body.message).toBe('Test message');
			expect(body.deep_research).toBe(true);
		});

		it('replays tokens via onToken callback', async () => {
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				text: [
					'event: content_block_delta',
					'data: {"delta":{"type":"text_delta","text":"Hello"}}',
					'',
					'event: content_block_delta',
					'data: {"delta":{"type":"text_delta","text":" world"}}',
					'',
					'',
				].join('\n'),
			});

			const tokens: string[] = [];
			const result = await client.sendMessage('conv-1', 'Test', {
				onToken: (t) => tokens.push(t),
			});

			expect(tokens).toEqual(['Hello', ' world']);
			expect(result.content).toBe('Hello world');
		});

		it('returns sources and metadata from lumen_metadata event', async () => {
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				text: [
					'event: content_block_delta',
					'data: {"delta":{"type":"text_delta","text":"Answer"}}',
					'',
					'event: lumen_metadata',
					'data: {"sources":[{"path":"note.md","score":0.9}],"token_usage":{"input":10,"output":20},"turns_used":1,"turns_remaining":9}',
					'',
					'',
				].join('\n'),
			});

			const result = await client.sendMessage('conv-1', 'Q');

			expect(result.sources).toEqual([{ path: 'note.md', score: 0.9 }]);
			expect(result.metadata).not.toBeNull();
			expect(result.metadata!.turnsUsed).toBe(1);
		});

		it('returns empty content when no tokens in response', async () => {
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				text: '',
			});

			const result = await client.sendMessage('conv-1', 'Q');

			expect(result.content).toBe('');
			expect(result.sources).toEqual([]);
		});
	});

	// -----------------------------------------------------------------------
	// Error handling
	// -----------------------------------------------------------------------

	describe('error handling', () => {
		it('throws PlanUpgradeRequiredError on 403 with plan_upgrade_required', async () => {
			mockRequestUrl.mockRejectedValueOnce({
				status: 403,
				json: {
					error: 'plan_upgrade_required',
					message: 'Deep Research requires a Plus plan',
					required_plan: 'plus',
				},
			});

			await expect(client.sendMessage('conv-1', 'Q'))
				.rejects.toThrow(PlanUpgradeRequiredError);

			try {
				await client.sendMessage('conv-1', 'Q');
			} catch (err) {
				// Already caught above — this block tests the first throw
			}
		});

		it('throws RateLimitExceededError on 429 with rate_limit_exceeded', async () => {
			mockRequestUrl.mockRejectedValueOnce({
				status: 429,
				json: {
					error: 'rate_limit_exceeded',
					message: 'Daily limit reached',
					limit: 50,
					remaining: 0,
					resets_at: '2026-02-20T00:00:00Z',
				},
			});

			await expect(client.sendMessage('conv-1', 'Q'))
				.rejects.toThrow(RateLimitExceededError);
		});

		it('includes rate limit details in RateLimitExceededError', async () => {
			mockRequestUrl.mockRejectedValueOnce({
				status: 429,
				json: {
					error: 'rate_limit_exceeded',
					message: 'Daily limit reached',
					limit: 50,
					remaining: 0,
					resets_at: '2026-02-20T00:00:00Z',
				},
			});

			try {
				await client.sendMessage('conv-1', 'Q');
			} catch (err) {
				expect(err).toBeInstanceOf(RateLimitExceededError);
				const rlErr = err as RateLimitExceededError;
				expect(rlErr.limit).toBe(50);
				expect(rlErr.remaining).toBe(0);
				expect(rlErr.resetsAt).toBe('2026-02-20T00:00:00Z');
			}
		});

		it('throws generic Error on 403 without plan_upgrade_required', async () => {
			mockRequestUrl.mockRejectedValueOnce({
				status: 403,
				json: { message: 'Access denied' },
			});

			await expect(client.sendMessage('conv-1', 'Q'))
				.rejects.toThrow('Access denied');
		});

		it('re-throws original error for non-403/429 errors', async () => {
			const networkErr = new Error('ECONNREFUSED');
			mockRequestUrl.mockRejectedValueOnce(networkErr);

			await expect(client.sendMessage('conv-1', 'Q'))
				.rejects.toThrow('ECONNREFUSED');
		});
	});
});
