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
				const rawToolsUsed = data['tools_used'] as Array<Record<string, unknown>> | undefined;
				metadata = {
					sources,
					tokenUsage: tokenUsage
						? { input: (tokenUsage['input'] as number) ?? 0, output: (tokenUsage['output'] as number) ?? 0 }
						: undefined,
					toolsUsed: Array.isArray(rawToolsUsed)
						? rawToolsUsed.filter(t => typeof t['name'] === 'string').map(t => ({ name: t['name'] as string }))
						: undefined,
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
	/** Tool use started (from content_block_start with type tool_use) */
	toolStart?: { id: string; name: string };
	/** Tool use completed — the tool's ID (from content_block_stop for a tool block) */
	toolComplete?: string;
	/** Thinking state (from thinking event) */
	thinking?: { type: string };
}

/**
 * Stateful incremental SSE parser for streaming via fetch + ReadableStream.
 *
 * Tracks tool use blocks to correctly emit toolComplete events,
 * and filters `<function_calls>` XML from text content.
 */
export class SSEStreamParser {
	/** Map of content block index → tool use info (for matching content_block_stop) */
	private activeToolBlocks = new Map<number, { id: string; name: string }>();

	/** Whether we're inside a `<function_calls>` XML block in text content */
	private inFunctionCall = false;

	/**
	 * Parse a chunk of SSE data incrementally.
	 *
	 * Splits on double-newline boundaries, parses complete events,
	 * and returns the incomplete remainder for the next call.
	 */
	parse(buffer: string): { events: ParsedSSEEvent[]; remaining: string } {
		const events: ParsedSSEEvent[] = [];

		const blocks = buffer.split('\n\n');
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
				let handled = false;

				if (eventType === 'content_block_start') {
					const contentBlock = data['content_block'] as Record<string, unknown> | undefined;
					const blockIndex = data['index'] as number | undefined;
					if (contentBlock?.['type'] === 'tool_use') {
						const id = (contentBlock['id'] as string) ?? '';
						const name = (contentBlock['name'] as string) ?? '';
						if (typeof blockIndex === 'number') {
							this.activeToolBlocks.set(blockIndex, { id, name });
						}
						event.toolStart = { id, name };
						handled = true;
					}
				} else if (eventType === 'content_block_stop') {
					const blockIndex = data['index'] as number | undefined;
					if (typeof blockIndex === 'number') {
						const toolInfo = this.activeToolBlocks.get(blockIndex);
						if (toolInfo) {
							event.toolComplete = toolInfo.id;
							this.activeToolBlocks.delete(blockIndex);
							handled = true;
						}
					}
				} else if (eventType === 'content_block_delta') {
					const delta = data['delta'] as Record<string, unknown> | undefined;
					if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
						const filtered = this.filterFunctionCalls(delta['text'] as string);
						if (filtered) {
							event.token = filtered;
						}
						handled = true;
					}
				} else if (eventType === 'thinking') {
					const thinkingType = (data['type'] as string) ?? 'thinking';
					event.thinking = { type: thinkingType };
					handled = true;
				} else if (eventType === 'lumen_metadata') {
					const rawSources = data['sources'] as Array<Record<string, unknown>> | undefined;
					if (Array.isArray(rawSources)) {
						event.sources = rawSources
							.filter(s => typeof s['path'] === 'string' && typeof s['score'] === 'number')
							.map(s => ({ path: s['path'] as string, score: s['score'] as number }));
					}
					const tokenUsage = data['token_usage'] as Record<string, unknown> | undefined;
					const rawToolsUsed = data['tools_used'] as Array<Record<string, unknown>> | undefined;
					event.metadata = {
						sources: event.sources ?? [],
						tokenUsage: tokenUsage
							? { input: (tokenUsage['input'] as number) ?? 0, output: (tokenUsage['output'] as number) ?? 0 }
							: undefined,
						toolsUsed: Array.isArray(rawToolsUsed)
							? rawToolsUsed.filter(t => typeof t['name'] === 'string').map(t => ({ name: t['name'] as string }))
							: undefined,
						turnsUsed: (data['turns_used'] as number) ?? 0,
						turnsRemaining: (data['turns_remaining'] as number) ?? 0,
					};
					handled = true;
				} else if (eventType === 'error') {
					const errorObj = data['error'] as Record<string, unknown> | undefined;
					event.error = (errorObj?.['message'] as string) ?? (data['message'] as string) ?? 'Unknown error';
					handled = true;
				}

				if (!handled) continue;

				// Only push events that have meaningful content
				if (
					event.token !== undefined ||
					event.sources ||
					event.metadata ||
					event.error ||
					event.toolStart ||
					event.toolComplete ||
					event.thinking
				) {
					events.push(event);
				}
			} catch {
				// Skip malformed JSON blocks
			}
		}

		return { events, remaining };
	}

	/** Reset parser state (call between conversations) */
	reset(): void {
		this.activeToolBlocks.clear();
		this.inFunctionCall = false;
	}

	/**
	 * Filter `<function_calls>...</function_calls>` XML from text content.
	 * Tracks state across chunks since tags may span multiple tokens.
	 * Returns the filtered text, or empty string if entirely inside a function call.
	 */
	private filterFunctionCalls(text: string): string {
		let result = '';
		let i = 0;

		while (i < text.length) {
			if (this.inFunctionCall) {
				// Look for closing tag
				const closeIdx = text.indexOf('</function_calls>', i);
				if (closeIdx === -1) {
					// Still inside — discard rest
					break;
				}
				// Skip past closing tag
				i = closeIdx + '</function_calls>'.length;
				this.inFunctionCall = false;
			} else {
				// Look for opening tag
				const openIdx = text.indexOf('<function_calls', i);
				if (openIdx === -1) {
					// No more tags — keep rest
					result += text.slice(i);
					break;
				}
				// Keep text before the tag
				result += text.slice(i, openIdx);
				this.inFunctionCall = true;
				i = openIdx;
			}
		}

		return result;
	}
}

/**
 * Parse a chunk of SSE data incrementally (stateless convenience wrapper).
 *
 * For streaming sessions that need tool tracking, use SSEStreamParser instead.
 */
export function parseSSEChunk(buffer: string): {
	events: ParsedSSEEvent[];
	remaining: string;
} {
	const parser = new SSEStreamParser();
	return parser.parse(buffer);
}
