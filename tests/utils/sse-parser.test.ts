import { describe, it, expect } from 'vitest';
import { parseSSEBuffer, parseConversationSSE } from '../../src/utils/sse-parser';

// ============================================================================
// Legacy SSE Parser (parseSSEBuffer)
// ============================================================================

describe('parseSSEBuffer', () => {
	it('parses a single content token', () => {
		const buffer = 'data: {"content":"Hello"}\n';
		const result = parseSSEBuffer(buffer);

		expect(result.tokens).toEqual(['Hello']);
		expect(result.sources).toEqual([]);
		expect(result.done).toBe(false);
		expect(result.remaining).toBe('');
	});

	it('parses multiple content tokens', () => {
		const buffer = 'data: {"content":"Hello"}\ndata: {"content":" world"}\n';
		const result = parseSSEBuffer(buffer);

		expect(result.tokens).toEqual(['Hello', ' world']);
		expect(result.done).toBe(false);
	});

	it('parses done event with sources', () => {
		const buffer = 'data: {"done":true,"sources":["notes/a.md","notes/b.md"]}\n';
		const result = parseSSEBuffer(buffer);

		expect(result.tokens).toEqual([]);
		expect(result.done).toBe(true);
		expect(result.sources).toEqual(['notes/a.md', 'notes/b.md']);
	});

	it('parses done event without sources', () => {
		const buffer = 'data: {"done":true}\n';
		const result = parseSSEBuffer(buffer);

		expect(result.done).toBe(true);
		expect(result.sources).toEqual([]);
	});

	it('handles mixed tokens and done in one buffer', () => {
		const buffer = [
			'data: {"content":"Hello"}',
			'data: {"content":" world"}',
			'data: {"done":true,"sources":["file.md"]}',
			'',
		].join('\n');

		const result = parseSSEBuffer(buffer);

		expect(result.tokens).toEqual(['Hello', ' world']);
		expect(result.done).toBe(true);
		expect(result.sources).toEqual(['file.md']);
	});

	it('preserves incomplete trailing line as remaining', () => {
		const buffer = 'data: {"content":"Hello"}\ndata: {"con';
		const result = parseSSEBuffer(buffer);

		expect(result.tokens).toEqual(['Hello']);
		expect(result.remaining).toBe('data: {"con');
	});

	it('returns empty remaining when buffer ends with newline', () => {
		const buffer = 'data: {"content":"Hello"}\n';
		const result = parseSSEBuffer(buffer);

		expect(result.remaining).toBe('');
	});

	it('skips blank lines and non-data lines', () => {
		const buffer = '\n: comment\nevent: message\ndata: {"content":"token"}\n\n';
		const result = parseSSEBuffer(buffer);

		expect(result.tokens).toEqual(['token']);
	});

	it('skips malformed JSON gracefully', () => {
		const buffer = 'data: not-json\ndata: {"content":"ok"}\n';
		const result = parseSSEBuffer(buffer);

		expect(result.tokens).toEqual(['ok']);
	});

	it('handles empty buffer', () => {
		const result = parseSSEBuffer('');

		expect(result.tokens).toEqual([]);
		expect(result.sources).toEqual([]);
		expect(result.done).toBe(false);
		expect(result.remaining).toBe('');
	});

	it('handles multi-chunk streaming simulation', () => {
		// Simulate two chunks where the first splits mid-JSON
		const chunk1 = 'data: {"content":"He';
		const result1 = parseSSEBuffer(chunk1);

		expect(result1.tokens).toEqual([]);
		expect(result1.remaining).toBe('data: {"content":"He');

		// Second chunk completes the line and adds more
		const chunk2 = result1.remaining + 'llo"}\ndata: {"content":" world"}\n';
		const result2 = parseSSEBuffer(chunk2);

		expect(result2.tokens).toEqual(['Hello', ' world']);
		expect(result2.remaining).toBe('');
	});

	it('handles empty content tokens', () => {
		const buffer = 'data: {"content":""}\n';
		const result = parseSSEBuffer(buffer);

		expect(result.tokens).toEqual(['']);
	});

	it('ignores data events with unexpected shape', () => {
		const buffer = 'data: {"unexpected":"value"}\ndata: {"content":"ok"}\n';
		const result = parseSSEBuffer(buffer);

		expect(result.tokens).toEqual(['ok']);
	});
});

// ============================================================================
// Conversations API SSE Parser (parseConversationSSE)
// ============================================================================

describe('parseConversationSSE', () => {
	it('parses a single content_block_delta event', () => {
		const buffer = [
			'event: content_block_delta',
			'data: {"delta":{"type":"text_delta","text":"Hello"}}',
			'',
			'',
		].join('\n');

		const result = parseConversationSSE(buffer);

		expect(result.tokens).toEqual(['Hello']);
		expect(result.sources).toEqual([]);
		expect(result.metadata).toBeNull();
		expect(result.errors).toEqual([]);
	});

	it('parses multiple content_block_delta events', () => {
		const buffer = [
			'event: content_block_delta',
			'data: {"delta":{"type":"text_delta","text":"Hello"}}',
			'',
			'event: content_block_delta',
			'data: {"delta":{"type":"text_delta","text":" world"}}',
			'',
			'',
		].join('\n');

		const result = parseConversationSSE(buffer);

		expect(result.tokens).toEqual(['Hello', ' world']);
	});

	it('extracts lumen_metadata with sources and token usage', () => {
		const buffer = [
			'event: lumen_metadata',
			'data: {"sources":[{"path":"notes/a.md","score":0.95},{"path":"notes/b.md","score":0.82}],"token_usage":{"input_tokens":150,"output_tokens":200},"turns_used":2,"turns_remaining":8}',
			'',
			'',
		].join('\n');

		const result = parseConversationSSE(buffer);

		expect(result.tokens).toEqual([]);
		expect(result.sources).toEqual([
			{ path: 'notes/a.md', score: 0.95 },
			{ path: 'notes/b.md', score: 0.82 },
		]);
		expect(result.metadata).toEqual({
			sources: [
				{ path: 'notes/a.md', score: 0.95 },
				{ path: 'notes/b.md', score: 0.82 },
			],
			tokenUsage: { input: 150, output: 200 },
			turnsUsed: 2,
			turnsRemaining: 8,
		});
	});

	it('collects error events', () => {
		const buffer = [
			'event: error',
			'data: {"error":{"message":"Rate limit exceeded"}}',
			'',
			'',
		].join('\n');

		const result = parseConversationSSE(buffer);

		expect(result.errors).toEqual(['Rate limit exceeded']);
		expect(result.tokens).toEqual([]);
	});

	it('handles mixed events in one response', () => {
		const buffer = [
			'event: message_start',
			'data: {"type":"message_start"}',
			'',
			'event: content_block_start',
			'data: {"type":"content_block_start"}',
			'',
			'event: content_block_delta',
			'data: {"delta":{"type":"text_delta","text":"Hello"}}',
			'',
			'event: content_block_delta',
			'data: {"delta":{"type":"text_delta","text":" world"}}',
			'',
			'event: content_block_stop',
			'data: {"type":"content_block_stop"}',
			'',
			'event: lumen_metadata',
			'data: {"sources":[{"path":"file.md","score":0.9}],"token_usage":{"input_tokens":10,"output_tokens":20},"turns_used":1,"turns_remaining":9}',
			'',
			'event: message_stop',
			'data: {"type":"message_stop"}',
			'',
			'',
		].join('\n');

		const result = parseConversationSSE(buffer);

		expect(result.tokens).toEqual(['Hello', ' world']);
		expect(result.sources).toEqual([{ path: 'file.md', score: 0.9 }]);
		expect(result.metadata).not.toBeNull();
		expect(result.metadata!.turnsUsed).toBe(1);
		expect(result.errors).toEqual([]);
	});

	it('skips non-text_delta deltas', () => {
		const buffer = [
			'event: content_block_delta',
			'data: {"delta":{"type":"input_json_delta","partial_json":"{\\"q\\""}}',
			'',
			'event: content_block_delta',
			'data: {"delta":{"type":"text_delta","text":"Real text"}}',
			'',
			'',
		].join('\n');

		const result = parseConversationSSE(buffer);

		expect(result.tokens).toEqual(['Real text']);
	});

	it('handles malformed JSON blocks gracefully', () => {
		const buffer = [
			'event: content_block_delta',
			'data: not valid json',
			'',
			'event: content_block_delta',
			'data: {"delta":{"type":"text_delta","text":"ok"}}',
			'',
			'',
		].join('\n');

		const result = parseConversationSSE(buffer);

		expect(result.tokens).toEqual(['ok']);
	});

	it('handles empty buffer', () => {
		const result = parseConversationSSE('');

		expect(result.tokens).toEqual([]);
		expect(result.sources).toEqual([]);
		expect(result.metadata).toBeNull();
		expect(result.errors).toEqual([]);
	});

	it('handles error event with fallback message key', () => {
		const buffer = [
			'event: error',
			'data: {"message":"Something went wrong"}',
			'',
			'',
		].join('\n');

		const result = parseConversationSSE(buffer);
		expect(result.errors).toEqual(['Something went wrong']);
	});

	it('filters invalid source entries', () => {
		const buffer = [
			'event: lumen_metadata',
			'data: {"sources":[{"path":"valid.md","score":0.9},{"invalid":true},{"path":"also-valid.md","score":0.5}],"token_usage":{"input_tokens":0,"output_tokens":0},"turns_used":0,"turns_remaining":0}',
			'',
			'',
		].join('\n');

		const result = parseConversationSSE(buffer);

		expect(result.sources).toEqual([
			{ path: 'valid.md', score: 0.9 },
			{ path: 'also-valid.md', score: 0.5 },
		]);
	});

	it('handles lumen_metadata with missing optional fields', () => {
		const buffer = [
			'event: lumen_metadata',
			'data: {"sources":[]}',
			'',
			'',
		].join('\n');

		const result = parseConversationSSE(buffer);

		expect(result.metadata).toEqual({
			sources: [],
			tokenUsage: undefined,
			turnsUsed: 0,
			turnsRemaining: 0,
		});
	});

	it('extracts tools_used from lumen_metadata', () => {
		const buffer = [
			'event: lumen_metadata',
			'data: {"sources":[],"token_usage":{"input_tokens":100,"output_tokens":50},"tools_used":[{"name":"semantic_search"},{"name":"get_document_context"}],"turns_used":1,"turns_remaining":9}',
			'',
			'',
		].join('\n');

		const result = parseConversationSSE(buffer);

		expect(result.metadata).not.toBeNull();
		expect(result.metadata!.toolsUsed).toEqual([
			{ name: 'semantic_search' },
			{ name: 'get_document_context' },
		]);
	});

	it('handles lumen_metadata without tools_used', () => {
		const buffer = [
			'event: lumen_metadata',
			'data: {"sources":[],"token_usage":{"input_tokens":10,"output_tokens":20},"turns_used":0,"turns_remaining":10}',
			'',
			'',
		].join('\n');

		const result = parseConversationSSE(buffer);

		expect(result.metadata).not.toBeNull();
		expect(result.metadata!.toolsUsed).toBeUndefined();
	});

	it('skips ping events', () => {
		const buffer = [
			'event: ping',
			'data: {}',
			'',
			'event: content_block_delta',
			'data: {"delta":{"type":"text_delta","text":"content"}}',
			'',
			'',
		].join('\n');

		const result = parseConversationSSE(buffer);

		expect(result.tokens).toEqual(['content']);
	});
});
