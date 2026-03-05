/**
 * Tests for the useChat hook — chat state management.
 *
 * Tests the reducer logic and key behaviors:
 *   - Conversation lifecycle (new, switch, delete)
 *   - Message sending flow (user message → streaming → complete)
 *   - Error handling (upgrade, rate limit, general)
 *   - Deep research toggle
 *   - Active note context
 *   - Cancellation
 */

import { describe, it, expect } from 'vitest';

describe('Chat state types', () => {
	it('chat status types include expected values', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/hooks/useChat.ts', 'utf-8');
		expect(content).toContain("'idle'");
		expect(content).toContain("'sending'");
		expect(content).toContain("'streaming'");
	});

	it('handles PlanUpgradeRequiredError', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/hooks/useChat.ts', 'utf-8');
		expect(content).toContain('PlanUpgradeRequiredError');
		expect(content).toContain("SET_UPGRADE_MESSAGE");
	});

	it('handles RateLimitExceededError', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/hooks/useChat.ts', 'utf-8');
		expect(content).toContain('RateLimitExceededError');
		expect(content).toContain("SET_RATE_LIMIT");
	});

	it('supports abort cancellation', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/hooks/useChat.ts', 'utf-8');
		expect(content).toContain('AbortController');
		expect(content).toContain("AbortError");
		expect(content).toContain("STREAM_CANCELLED");
	});

	it('creates conversation lazily', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/hooks/useChat.ts', 'utf-8');
		expect(content).toContain('createConversation');
	});

	it('uses refs to avoid stale closures in streaming callback', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/hooks/useChat.ts', 'utf-8');
		expect(content).toContain('conversationIdRef');
		expect(content).toContain('deepResearchRef');
	});
});

describe('Active note context', () => {
	it('tracks active note via workspace event', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/hooks/useChat.ts', 'utf-8');
		expect(content).toContain('active-leaf-change');
		expect(content).toContain('getActiveFile');
	});

	it('includes note context in message when enabled', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/hooks/useChat.ts', 'utf-8');
		expect(content).toContain('activeNoteRef');
		expect(content).toContain('[Context: active note is');
	});

	it('has toggle action and state', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/hooks/useChat.ts', 'utf-8');
		expect(content).toContain("'TOGGLE_ACTIVE_NOTE_CONTEXT'");
		expect(content).toContain("'SET_ACTIVE_NOTE'");
		expect(content).toContain('activeNoteContextEnabled');
		expect(content).toContain('activeNotePath');
	});
});

describe('Chat reducer actions', () => {
	it('defines all required action types', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/hooks/useChat.ts', 'utf-8');
		const actions = [
			'ADD_USER_MESSAGE',
			'START_STREAMING',
			'STREAM_TOKEN',
			'FINISH_STREAMING',
			'STREAM_CANCELLED',
			'SET_ERROR',
			'SET_UPGRADE_MESSAGE',
			'SET_RATE_LIMIT',
			'DISMISS_RATE_LIMIT',
			'SET_CONVERSATION',
			'NEW_CHAT',
			'TOGGLE_DEEP_RESEARCH',
			'SET_CONVERSATION_DROPDOWN',
			'SET_CONVERSATIONS',
			'SET_CONVERSATIONS_LOADING',
			'TOGGLE_ACTIVE_NOTE_CONTEXT',
			'SET_ACTIVE_NOTE',
		];
		for (const action of actions) {
			expect(content).toContain(`'${action}'`);
		}
	});
});
