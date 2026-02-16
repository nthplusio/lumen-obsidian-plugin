/**
 * Debug logging utility for the Lumen Obsidian plugin.
 *
 * Respects the debugMode setting — debug() calls are no-ops when
 * debugMode is false. info/warn/error always log.
 *
 * All messages are prefixed with "[Lumen]" for easy console filtering.
 *
 * Features:
 *   - In-memory ring buffer (max 500 entries, FIFO eviction)
 *   - M2 API key redaction — sensitive tokens are sanitized before
 *     console output AND before buffer storage
 *   - Real-time listener API for the Debug Log Viewer
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
}

export type LogEntryListener = (entry: LogEntry) => void;

// ---------------------------------------------------------------------------
// Redaction (M2 — API Key Logging Sanitization)
// ---------------------------------------------------------------------------

/**
 * Redaction rules for sensitive data that must NEVER appear in logs.
 *
 * Patterns (from spec section 6.2, M2):
 *   1. Auth headers:    X-API-Key: <value>  or  Authorization: <value>
 *      (preserves header name for debuggability)
 *   2. Bearer tokens:   Bearer <token>
 *   3. Lumen API keys:  vr_<alphanum>
 *
 * Order matters — headers are matched first so their values don't
 * also match the bare API key pattern.
 */
const REDACTION_RULES: Array<{ pattern: RegExp; replacement: string }> = [
	{ pattern: /(X-API-Key|Authorization):\s*[^\s,}]+/gi, replacement: '$1: ***REDACTED***' },
	{ pattern: /Bearer\s+[a-zA-Z0-9_-]+/gi, replacement: 'Bearer ***REDACTED***' },
	{ pattern: /vr_[a-zA-Z0-9_-]+/g, replacement: '***REDACTED***' },
];

/**
 * Redact sensitive tokens from a string.
 *
 * Applied to every logged argument before console output and buffer storage.
 */
export function redact(text: string): string {
	let result = text;
	for (const { pattern, replacement } of REDACTION_RULES) {
		result = result.replace(pattern, replacement);
	}
	return result;
}

// ---------------------------------------------------------------------------
// Ring Buffer
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 500;

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const PREFIX = '[Lumen]';

export class Logger {
	private debugEnabled: boolean;

	// Ring buffer — circular array with write index
	private buffer: LogEntry[] = [];
	private writeIndex = 0;
	private entryCount = 0;

	// Real-time listeners
	private listeners: Set<LogEntryListener> = new Set();

	constructor(debugEnabled = false) {
		this.debugEnabled = debugEnabled;
	}

	setDebugMode(enabled: boolean): void {
		this.debugEnabled = enabled;
	}

	// -------------------------------------------------------------------
	// Logging methods (backward-compatible signatures)
	// -------------------------------------------------------------------

	debug(...args: unknown[]): void {
		if (!this.debugEnabled) return;

		const message = this.formatArgs(args);
		const redacted = redact(message);
		this.addEntry('debug', redacted);
		console.log(PREFIX, redacted);
	}

	info(...args: unknown[]): void {
		const message = this.formatArgs(args);
		const redacted = redact(message);
		this.addEntry('info', redacted);
		console.log(PREFIX, redacted);
	}

	warn(...args: unknown[]): void {
		const message = this.formatArgs(args);
		const redacted = redact(message);
		this.addEntry('warn', redacted);
		console.warn(PREFIX, redacted);
	}

	error(...args: unknown[]): void {
		const message = this.formatArgs(args);
		const redacted = redact(message);
		this.addEntry('error', redacted);
		console.error(PREFIX, redacted);
	}

	// -------------------------------------------------------------------
	// Ring buffer API (for Debug Log Viewer)
	// -------------------------------------------------------------------

	/** Return all buffered entries in chronological order. */
	getEntries(): LogEntry[] {
		if (this.entryCount <= MAX_ENTRIES) {
			// Buffer hasn't wrapped yet — entries are already in order
			return this.buffer.slice(0, this.entryCount);
		}
		// Buffer has wrapped — read from writeIndex to end, then start to writeIndex
		return [
			...this.buffer.slice(this.writeIndex),
			...this.buffer.slice(0, this.writeIndex),
		];
	}

	/** Clear all buffered entries. */
	clear(): void {
		this.buffer = [];
		this.writeIndex = 0;
		this.entryCount = 0;
	}

	// -------------------------------------------------------------------
	// Listener API (real-time updates for Debug Log Viewer)
	// -------------------------------------------------------------------

	/** Subscribe to new log entries. */
	onEntry(callback: LogEntryListener): void {
		this.listeners.add(callback);
	}

	/** Unsubscribe from log entries. */
	removeListener(callback: LogEntryListener): void {
		this.listeners.delete(callback);
	}

	// -------------------------------------------------------------------
	// Private
	// -------------------------------------------------------------------

	private addEntry(level: LogLevel, message: string): void {
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			message,
		};

		// Write to ring buffer (circular overwrite when full)
		if (this.buffer.length < MAX_ENTRIES) {
			this.buffer.push(entry);
		} else {
			this.buffer[this.writeIndex] = entry;
		}
		this.writeIndex = (this.writeIndex + 1) % MAX_ENTRIES;
		this.entryCount++;

		// Notify listeners
		for (const listener of this.listeners) {
			try {
				listener(entry);
			} catch {
				// Never let a listener error break logging
			}
		}
	}

	/**
	 * Serialize variadic args into a single string.
	 *
	 * Mirrors how console.log joins arguments, but produces a single
	 * string suitable for redaction and buffer storage.
	 */
	private formatArgs(args: unknown[]): string {
		return args
			.map((arg) => {
				if (typeof arg === 'string') return arg;
				if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
				try {
					return JSON.stringify(arg);
				} catch {
					return String(arg);
				}
			})
			.join(' ');
	}
}

/** Singleton logger instance. Call setDebugMode() after loading settings. */
export const logger = new Logger(false);
