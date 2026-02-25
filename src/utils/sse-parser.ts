/**
 * SSE parsers for chat responses.
 *
 * Two parsers:
 *   - parseSSEBuffer() — Legacy format: `data: {"content":"..."}` (used by /api/chat)
 *   - parseConversationSSE() — Claude-aligned format (used by /api/conversations/:id/messages)
 */

import type { ChatSource, StreamMetadata } from '../types';

// ============================================================================
// Legacy SSE Parser (for /api/chat)
// ============================================================================

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

// ============================================================================
// Conversations API SSE Parser (Claude-aligned events)
// ============================================================================

export interface ConversationSSEResult {
	/** Content tokens extracted from content_block_delta events */
	tokens: string[];
	/** Sources from lumen_metadata event */
	sources: ChatSource[];
	/** Full metadata from lumen_metadata event */
	metadata: StreamMetadata | null;
	/** Error messages from error events */
	errors: string[];
}

/**
 * Parse a buffered SSE response from the conversations API.
 *
 * Event types handled:
 *   - content_block_delta: {"delta":{"type":"text_delta","text":"..."}} → extract text token
 *   - lumen_metadata: {"sources":[...],"token_usage":{},...} → extract metadata
 *   - error: {"error":{"message":"..."}} → collect error
 *   - All others (message_start, content_block_start/stop, message_delta,
 *     message_stop, thinking, tool_result, ping) → skip
 */
export function parseConversationSSE(buffer: string): ConversationSSEResult {
	const tokens: string[] = [];
	let sources: ChatSource[] = [];
	let metadata: StreamMetadata | null = null;
	const errors: string[] = [];

	// SSE events are separated by double newlines
	const blocks = buffer.split('\n\n');

	for (const block of blocks) {
		const trimmedBlock = block.trim();
		if (!trimmedBlock) continue;

		let eventType = '';
		let dataStr = '';

		for (const line of trimmedBlock.split('\n')) {
			const trimmed = line.trim();
			if (trimmed.startsWith('event: ')) {
				eventType = trimmed.slice(7).trim();
			} else if (trimmed.startsWith('data: ')) {
				// Accumulate data lines (SSE spec allows multiple data: lines per event)
				dataStr += (dataStr ? '\n' : '') + trimmed.slice(6);
			} else if (trimmed.startsWith('data:')) {
				// Handle "data:" with no space (edge case per SSE spec)
				dataStr += (dataStr ? '\n' : '') + trimmed.slice(5);
			}
		}

		if (!dataStr) continue;

		try {
			const data = JSON.parse(dataStr) as Record<string, unknown>;

			if (eventType === 'content_block_delta') {
				const delta = data['delta'] as Record<string, unknown> | undefined;
				if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
					tokens.push(delta['text'] as string);
				}
			} else if (eventType === 'lumen_metadata') {
				const rawSources = data['sources'] as Array<Record<string, unknown>> | undefined;
				if (Array.isArray(rawSources)) {
					sources = rawSources
						.filter(s => typeof s['path'] === 'string' && typeof s['score'] === 'number')
						.map(s => ({ path: s['path'] as string, score: s['score'] as number }));
				}
				const tokenUsage = data['token_usage'] as Record<string, unknown> | undefined;
				metadata = {
					sources,
					tokenUsage: {
						input: (tokenUsage?.['input'] as number) ?? 0,
						output: (tokenUsage?.['output'] as number) ?? 0,
					},
					turnsUsed: (data['turns_used'] as number) ?? 0,
					turnsRemaining: (data['turns_remaining'] as number) ?? 0,
				};
			} else if (eventType === 'error') {
				const errorObj = data['error'] as Record<string, unknown> | undefined;
				const errMsg = (errorObj?.['message'] as string) ?? (data['message'] as string) ?? 'Unknown error';
				errors.push(errMsg);
			}
			// All other event types (message_start, content_block_start/stop,
			// message_delta, message_stop, thinking, tool_result, ping) → skip
		} catch {
			// Skip malformed JSON blocks
		}
	}

	return { tokens, sources, metadata, errors };
}

// ============================================================================
// Incremental SSE Parser (for streaming via fetch + ReadableStream)
// ============================================================================

/** Single parsed SSE event from incremental parsing */
export interface ParsedSSEEvent {
	/** Token text (from content_block_delta) */
	token?: string;
	/** Sources (from lumen_metadata) */
	sources?: ChatSource[];
	/** Full metadata (from lumen_metadata) */
	metadata?: StreamMetadata;
	/** Error message (from error event) */
	error?: string;
}

/**
 * Parse a chunk of SSE data incrementally.
 *
 * Splits on double-newline boundaries, parses complete events,
 * and returns the incomplete remainder for the next call.
 *
 * @param buffer Accumulated SSE text (may contain incomplete events)
 * @returns Parsed events and remaining incomplete buffer
 */
export function parseSSEChunk(buffer: string): {
	events: ParsedSSEEvent[];
	remaining: string;
} {
	const events: ParsedSSEEvent[] = [];

	// Split on double newlines — SSE event boundaries
	const blocks = buffer.split('\n\n');

	// Last element may be incomplete — keep as remainder
	const remaining = blocks.pop() ?? '';

	for (const block of blocks) {
		const trimmedBlock = block.trim();
		if (!trimmedBlock) continue;

		let eventType = '';
		let dataStr = '';

		for (const line of trimmedBlock.split('\n')) {
			const trimmed = line.trim();
			if (trimmed.startsWith('event: ')) {
				eventType = trimmed.slice(7).trim();
			} else if (trimmed.startsWith('data: ')) {
				dataStr += (dataStr ? '\n' : '') + trimmed.slice(6);
			} else if (trimmed.startsWith('data:')) {
				dataStr += (dataStr ? '\n' : '') + trimmed.slice(5);
			}
		}

		if (!dataStr) continue;

		try {
			const data = JSON.parse(dataStr) as Record<string, unknown>;
			const event: ParsedSSEEvent = {};

			if (eventType === 'content_block_delta') {
				const delta = data['delta'] as Record<string, unknown> | undefined;
				if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
					event.token = delta['text'] as string;
				}
			} else if (eventType === 'lumen_metadata') {
				const rawSources = data['sources'] as Array<Record<string, unknown>> | undefined;
				if (Array.isArray(rawSources)) {
					event.sources = rawSources
						.filter(s => typeof s['path'] === 'string' && typeof s['score'] === 'number')
						.map(s => ({ path: s['path'] as string, score: s['score'] as number }));
				}
				const tokenUsage = data['token_usage'] as Record<string, unknown> | undefined;
				event.metadata = {
					sources: event.sources ?? [],
					tokenUsage: {
						input: (tokenUsage?.['input'] as number) ?? 0,
						output: (tokenUsage?.['output'] as number) ?? 0,
					},
					turnsUsed: (data['turns_used'] as number) ?? 0,
					turnsRemaining: (data['turns_remaining'] as number) ?? 0,
				};
			} else if (eventType === 'error') {
				const errorObj = data['error'] as Record<string, unknown> | undefined;
				event.error = (errorObj?.['message'] as string) ?? (data['message'] as string) ?? 'Unknown error';
			} else {
				// Skip non-content events (message_start, ping, etc.)
				continue;
			}

			// Only push events that have meaningful content
			if (event.token !== undefined || event.sources || event.metadata || event.error) {
				events.push(event);
			}
		} catch {
			// Skip malformed JSON blocks
		}
	}

	return { events, remaining };
}
