/**
 * Unit tests for the enhanced Logger (ring buffer, M2 redaction, listener API).
 *
 * Tests:
 *   - Ring buffer: FIFO storage, max 500 entries, circular overwrite
 *   - M2 redaction: API keys (vr_*), Authorization headers, Bearer tokens
 *   - Level gating: debug() is a no-op when debugMode is false
 *   - Listener API: onEntry(), removeListener()
 *   - clear() empties buffer
 *   - getEntries() returns chronological copy
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, redact, type LogEntry } from '../../src/utils/logger';

// Suppress console output during tests
beforeEach(() => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// redact() — M2 API Key Logging Sanitization
// ---------------------------------------------------------------------------

describe('redact()', () => {
	it('redacts vr_ API keys', () => {
		expect(redact('key is vr_abc123_XYZ')).toBe('key is ***REDACTED***');
	});

	it('redacts Authorization header values', () => {
		// The header pattern captures the first non-whitespace token after the colon.
		// For "Authorization: secret_value", the entire value is redacted.
		expect(redact('Authorization: secret_value')).toBe(
			'Authorization: ***REDACTED***',
		);
	});

	it('redacts X-API-Key header values', () => {
		expect(redact('X-API-Key: vr_secret123')).toBe(
			'X-API-Key: ***REDACTED***',
		);
	});

	it('redacts Bearer tokens', () => {
		expect(redact('token is Bearer abc123def')).toBe(
			'token is Bearer ***REDACTED***',
		);
	});

	it('preserves non-sensitive content', () => {
		const msg = 'Sync complete: 5 files uploaded';
		expect(redact(msg)).toBe(msg);
	});

	it('handles multiple sensitive tokens in one string', () => {
		const input = 'key=vr_abc header: X-API-Key: vr_xyz';
		const result = redact(input);
		expect(result).not.toContain('vr_abc');
		expect(result).not.toContain('vr_xyz');
	});

	it('is case-insensitive for header names', () => {
		expect(redact('x-api-key: vr_test')).toBe('x-api-key: ***REDACTED***');
		expect(redact('AUTHORIZATION: secret')).toBe(
			'AUTHORIZATION: ***REDACTED***',
		);
	});
});

// ---------------------------------------------------------------------------
// Logger — Level gating
// ---------------------------------------------------------------------------

describe('Logger level gating', () => {
	it('debug() is a no-op when debugMode is false', () => {
		const logger = new Logger(false);
		logger.debug('should not appear');
		expect(logger.getEntries()).toHaveLength(0);
	});

	it('debug() logs when debugMode is true', () => {
		const logger = new Logger(true);
		logger.debug('should appear');
		expect(logger.getEntries()).toHaveLength(1);
		expect(logger.getEntries()[0].level).toBe('debug');
	});

	it('info/warn/error always log regardless of debugMode', () => {
		const logger = new Logger(false);
		logger.info('info');
		logger.warn('warn');
		logger.error('error');
		expect(logger.getEntries()).toHaveLength(3);
		expect(logger.getEntries().map((e) => e.level)).toEqual([
			'info',
			'warn',
			'error',
		]);
	});

	it('setDebugMode(true) enables debug logging', () => {
		const logger = new Logger(false);
		logger.debug('before');
		expect(logger.getEntries()).toHaveLength(0);

		logger.setDebugMode(true);
		logger.debug('after');
		expect(logger.getEntries()).toHaveLength(1);
	});

	it('setDebugMode(false) disables debug logging', () => {
		const logger = new Logger(true);
		logger.debug('enabled');
		expect(logger.getEntries()).toHaveLength(1);

		logger.setDebugMode(false);
		logger.debug('disabled');
		expect(logger.getEntries()).toHaveLength(1); // still just the first one
	});
});

// ---------------------------------------------------------------------------
// Logger — Ring buffer
// ---------------------------------------------------------------------------

describe('Logger ring buffer', () => {
	it('stores entries in chronological order', () => {
		const logger = new Logger(true);
		logger.info('first');
		logger.info('second');
		logger.info('third');

		const entries = logger.getEntries();
		expect(entries).toHaveLength(3);
		expect(entries[0].message).toBe('first');
		expect(entries[1].message).toBe('second');
		expect(entries[2].message).toBe('third');
	});

	it('includes timestamp, level, and message in each entry', () => {
		const logger = new Logger(true);
		logger.warn('test warning');

		const entry = logger.getEntries()[0];
		expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(entry.level).toBe('warn');
		expect(entry.message).toBe('test warning');
	});

	it('caps at 500 entries (FIFO eviction)', () => {
		const logger = new Logger(false);

		// Write 600 entries
		for (let i = 0; i < 600; i++) {
			logger.info(`entry-${i}`);
		}

		const entries = logger.getEntries();
		expect(entries).toHaveLength(500);

		// Oldest entries (0-99) should have been evicted
		expect(entries[0].message).toBe('entry-100');
		// Most recent should be last
		expect(entries[499].message).toBe('entry-599');
	});

	it('maintains chronological order after buffer wraps', () => {
		const logger = new Logger(false);

		for (let i = 0; i < 510; i++) {
			logger.info(`msg-${i}`);
		}

		const entries = logger.getEntries();
		// Verify entries are in ascending order
		for (let i = 1; i < entries.length; i++) {
			const prev = parseInt(entries[i - 1].message.split('-')[1]);
			const curr = parseInt(entries[i].message.split('-')[1]);
			expect(curr).toBe(prev + 1);
		}
	});

	it('getEntries() returns a copy (not a live reference)', () => {
		const logger = new Logger(false);
		logger.info('test');
		const entries1 = logger.getEntries();
		const entries2 = logger.getEntries();
		expect(entries1).not.toBe(entries2);
	});
});

// ---------------------------------------------------------------------------
// Logger — clear()
// ---------------------------------------------------------------------------

describe('Logger clear()', () => {
	it('empties the buffer', () => {
		const logger = new Logger(false);
		logger.info('a');
		logger.info('b');
		expect(logger.getEntries()).toHaveLength(2);

		logger.clear();
		expect(logger.getEntries()).toHaveLength(0);
	});

	it('allows new entries after clearing', () => {
		const logger = new Logger(false);
		logger.info('before');
		logger.clear();
		logger.info('after');

		const entries = logger.getEntries();
		expect(entries).toHaveLength(1);
		expect(entries[0].message).toBe('after');
	});
});

// ---------------------------------------------------------------------------
// Logger — Listener API
// ---------------------------------------------------------------------------

describe('Logger listener API', () => {
	it('onEntry() fires for each new log entry', () => {
		const logger = new Logger(false);
		const received: LogEntry[] = [];
		logger.onEntry((entry) => received.push(entry));

		logger.info('hello');
		logger.warn('world');

		expect(received).toHaveLength(2);
		expect(received[0].message).toBe('hello');
		expect(received[1].message).toBe('world');
	});

	it('removeListener() stops notifications', () => {
		const logger = new Logger(false);
		const received: LogEntry[] = [];
		const listener = (entry: LogEntry) => received.push(entry);

		logger.onEntry(listener);
		logger.info('first');
		expect(received).toHaveLength(1);

		logger.removeListener(listener);
		logger.info('second');
		expect(received).toHaveLength(1); // no new entry
	});

	it('supports multiple listeners', () => {
		const logger = new Logger(false);
		const a: string[] = [];
		const b: string[] = [];

		logger.onEntry((e) => a.push(e.message));
		logger.onEntry((e) => b.push(e.message));

		logger.info('test');
		expect(a).toEqual(['test']);
		expect(b).toEqual(['test']);
	});

	it('does not break logging if a listener throws', () => {
		const logger = new Logger(false);
		const received: string[] = [];

		logger.onEntry(() => {
			throw new Error('bad listener');
		});
		logger.onEntry((e) => received.push(e.message));

		// Should not throw and second listener should still fire
		logger.info('survives');
		expect(received).toEqual(['survives']);
		expect(logger.getEntries()).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Logger — Redaction integration
// ---------------------------------------------------------------------------

describe('Logger redaction integration', () => {
	it('redacts sensitive data in logged messages', () => {
		const logger = new Logger(true);
		logger.debug('Sending X-API-Key: vr_supersecret123');

		const entry = logger.getEntries()[0];
		expect(entry.message).not.toContain('vr_supersecret123');
		expect(entry.message).toContain('***REDACTED***');
	});

	it('redacts sensitive data in console output', () => {
		const spy = vi.spyOn(console, 'log');
		const logger = new Logger(true);
		logger.debug('Bearer my_token_123');

		expect(spy).toHaveBeenCalledWith(
			'[Lumen]',
			'Bearer ***REDACTED***',
		);
	});

	it('redacts data before storing in ring buffer', () => {
		const logger = new Logger(false);
		logger.info('key=vr_abc123');

		const entries = logger.getEntries();
		expect(entries[0].message).toBe('key=***REDACTED***');
	});

	it('redacts data before notifying listeners', () => {
		const logger = new Logger(false);
		let received = '';
		logger.onEntry((e) => {
			received = e.message;
		});

		logger.info('Authorization: secret_value');
		expect(received).not.toContain('secret_value');
	});
});

// ---------------------------------------------------------------------------
// Logger — Argument formatting
// ---------------------------------------------------------------------------

describe('Logger argument formatting', () => {
	it('joins multiple arguments with spaces', () => {
		const logger = new Logger(false);
		logger.info('count:', 42, 'status:', true);

		expect(logger.getEntries()[0].message).toBe('count: 42 status: true');
	});

	it('serializes Error objects as name: message', () => {
		const logger = new Logger(false);
		logger.error(new Error('test error'));

		expect(logger.getEntries()[0].message).toBe('Error: test error');
	});

	it('JSON-stringifies plain objects', () => {
		const logger = new Logger(false);
		logger.info({ key: 'value' });

		expect(logger.getEntries()[0].message).toBe('{"key":"value"}');
	});
});
