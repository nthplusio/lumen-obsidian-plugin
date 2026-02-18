/**
 * Pure-function SSE line parser for streaming chat responses.
 *
 * Processes a buffer of SSE text, extracts `data:` lines, and returns
 * parsed tokens and any remaining incomplete line. Designed for use
 * with ReadableStream where chunks may split across SSE event boundaries.
 */

export interface SSEParseResult {
	/** Content tokens extracted from `data: {"content":"..."}` events */
	tokens: string[];
	/** Source file paths from the final `data: {"done":true,"sources":[...]}` event */
	sources: string[];
	/** Whether the stream signalled completion */
	done: boolean;
	/** Incomplete trailing data to prepend to the next chunk */
	remaining: string;
}

/**
 * Parse a buffer of SSE text into structured results.
 *
 * Server contract:
 *   data: {"content":"token"}       — streamed content token
 *   data: {"done":true,"sources":[...]} — stream complete
 */
export function parseSSEBuffer(buffer: string): SSEParseResult {
	const tokens: string[] = [];
	let sources: string[] = [];
	let done = false;

	const lines = buffer.split('\n');

	// If buffer doesn't end with a newline, the last line is incomplete
	let remaining = '';
	if (!buffer.endsWith('\n')) {
		remaining = lines.pop() ?? '';
	}

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || !trimmed.startsWith('data: ')) continue;

		const jsonStr = trimmed.slice(6);
		try {
			const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
			if (parsed['done']) {
				done = true;
				if (Array.isArray(parsed['sources'])) {
					sources = parsed['sources'] as string[];
				}
			} else if (typeof parsed['content'] === 'string') {
				tokens.push(parsed['content'] as string);
			}
		} catch {
			// Skip malformed JSON lines
		}
	}

	return { tokens, sources, done, remaining };
}
