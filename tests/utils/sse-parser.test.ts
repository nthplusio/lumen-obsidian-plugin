import { describe, it, expect } from 'vitest';
import { parseSSEBuffer } from '../../src/utils/sse-parser';

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
