/**
 * Error classifier unit tests.
 *
 * Tests all classification branches in classifyError():
 *   - Auth errors: 401 (Unauthorized), 403 (Forbidden)
 *   - Validation errors: 400, 404, 410, 413, 422
 *   - Rate limiting: 429
 *   - Server errors: 500, 502, 503, 504
 *   - Timeout errors: ETIMEDOUT, timeout, AbortError
 *   - Network errors: ENOTFOUND, ECONNREFUSED, ECONNRESET, Failed to fetch
 *   - Non-Error inputs: strings, objects, null, undefined
 */

import { describe, it, expect } from 'vitest';
import { classifyError } from '../../src/utils/error-classifier';
import type { ClassifiedError } from '../../src/utils/error-classifier';

// ---------------------------------------------------------------------------
// Auth errors (non-retryable)
// ---------------------------------------------------------------------------

describe('classifyError — auth errors', () => {
	it('classifies 401 status as auth error', () => {
		const result = classifyError(new Error('Request failed with status 401'));
		expect(result.category).toBe('auth');
		expect(result.retryable).toBe(false);
		expect(result.statusCode).toBe(401);
	});

	it('classifies "Unauthorized" message as auth error', () => {
		const result = classifyError(new Error('Unauthorized'));
		expect(result.category).toBe('auth');
		expect(result.retryable).toBe(false);
		expect(result.statusCode).toBe(401);
	});

	it('classifies "Authentication" message as auth error', () => {
		const result = classifyError(new Error('Authentication required'));
		expect(result.category).toBe('auth');
		expect(result.retryable).toBe(false);
		expect(result.statusCode).toBe(401);
	});

	it('classifies 403 status as auth error', () => {
		const result = classifyError(new Error('Request failed with status 403'));
		expect(result.category).toBe('auth');
		expect(result.retryable).toBe(false);
		expect(result.statusCode).toBe(403);
	});

	it('classifies "Forbidden" message as auth error', () => {
		const result = classifyError(new Error('Forbidden'));
		expect(result.category).toBe('auth');
		expect(result.retryable).toBe(false);
		expect(result.statusCode).toBe(403);
	});
});

// ---------------------------------------------------------------------------
// Validation errors (non-retryable, except 422)
// ---------------------------------------------------------------------------

describe('classifyError — validation errors', () => {
	it('classifies 400 as validation error', () => {
		const result = classifyError(new Error('400 Bad Request'));
		expect(result.category).toBe('validation');
		expect(result.retryable).toBe(false);
		expect(result.statusCode).toBe(400);
	});

	it('classifies "Bad Request" as validation error', () => {
		const result = classifyError(new Error('Bad Request: missing field'));
		expect(result.category).toBe('validation');
		expect(result.retryable).toBe(false);
		expect(result.statusCode).toBe(400);
	});

	it('classifies VALIDATION_ERROR as validation error', () => {
		const result = classifyError(new Error('VALIDATION_ERROR: invalid path'));
		expect(result.category).toBe('validation');
		expect(result.retryable).toBe(false);
		expect(result.statusCode).toBe(400);
	});

	it('classifies 404 as config error', () => {
		const result = classifyError(new Error('404 Not Found'));
		expect(result.category).toBe('config');
		expect(result.retryable).toBe(false);
		expect(result.statusCode).toBe(404);
	});

	it('classifies "Not Found" as config error', () => {
		const result = classifyError(new Error('Endpoint Not Found'));
		expect(result.category).toBe('config');
		expect(result.retryable).toBe(false);
		expect(result.statusCode).toBe(404);
	});

	it('classifies 410 as validation error (sync session expired)', () => {
		const result = classifyError(new Error('410 Gone'));
		expect(result.category).toBe('validation');
		expect(result.retryable).toBe(false);
		expect(result.statusCode).toBe(410);
	});

	it('classifies SYNC_SESSION_EXPIRED as validation error', () => {
		const result = classifyError(new Error('SYNC_SESSION_EXPIRED'));
		expect(result.category).toBe('validation');
		expect(result.retryable).toBe(false);
		expect(result.statusCode).toBe(410);
	});

	it('classifies 413 as validation error (file too large)', () => {
		const result = classifyError(new Error('413 Payload Too Large'));
		expect(result.category).toBe('validation');
		expect(result.retryable).toBe(false);
		expect(result.statusCode).toBe(413);
	});

	it('classifies "Too Large" as validation error', () => {
		const result = classifyError(new Error('File Too Large'));
		expect(result.category).toBe('validation');
		expect(result.retryable).toBe(false);
		expect(result.statusCode).toBe(413);
	});

	it('classifies FILE_TOO_LARGE as validation error', () => {
		const result = classifyError(new Error('FILE_TOO_LARGE'));
		expect(result.category).toBe('validation');
		expect(result.retryable).toBe(false);
		expect(result.statusCode).toBe(413);
	});

	it('classifies 422 as validation error (retryable)', () => {
		const result = classifyError(new Error('422 Unprocessable Entity'));
		expect(result.category).toBe('validation');
		expect(result.retryable).toBe(true);
		expect(result.statusCode).toBe(422);
	});

	it('classifies HASH_MISMATCH as validation error (retryable)', () => {
		const result = classifyError(new Error('HASH_MISMATCH'));
		expect(result.category).toBe('validation');
		expect(result.retryable).toBe(true);
		expect(result.statusCode).toBe(422);
	});
});

// ---------------------------------------------------------------------------
// Rate limiting (retryable)
// ---------------------------------------------------------------------------

describe('classifyError — rate limiting', () => {
	it('classifies 429 as rate-limit error', () => {
		const result = classifyError(new Error('429 Too Many Requests'));
		expect(result.category).toBe('rate-limit');
		expect(result.retryable).toBe(true);
		expect(result.statusCode).toBe(429);
	});

	it('classifies "rate limit" message as rate-limit error', () => {
		const result = classifyError(new Error('rate limit exceeded'));
		expect(result.category).toBe('rate-limit');
		expect(result.retryable).toBe(true);
	});

	it('classifies RATE_LIMIT as rate-limit error', () => {
		const result = classifyError(new Error('RATE_LIMIT'));
		expect(result.category).toBe('rate-limit');
		expect(result.retryable).toBe(true);
	});

	it('classifies "Too Many" as rate-limit error', () => {
		const result = classifyError(new Error('Too Many requests'));
		expect(result.category).toBe('rate-limit');
		expect(result.retryable).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Server errors (retryable)
// ---------------------------------------------------------------------------

describe('classifyError — server errors', () => {
	it('classifies 500 as server error', () => {
		const result = classifyError(new Error('500 Internal Server Error'));
		expect(result.category).toBe('server');
		expect(result.retryable).toBe(true);
		expect(result.statusCode).toBe(500);
	});

	it('classifies 502 as server error', () => {
		const result = classifyError(new Error('502 Bad Gateway'));
		expect(result.category).toBe('server');
		expect(result.retryable).toBe(true);
		expect(result.statusCode).toBe(502);
	});

	it('classifies 503 as server error', () => {
		const result = classifyError(new Error('503 Service Unavailable'));
		expect(result.category).toBe('server');
		expect(result.retryable).toBe(true);
		expect(result.statusCode).toBe(503);
	});

	it('classifies 504 as server error', () => {
		const result = classifyError(new Error('504 Gateway Timeout'));
		expect(result.category).toBe('server');
		expect(result.retryable).toBe(true);
		expect(result.statusCode).toBe(504);
	});

	it('extracts status code from message containing 5xx', () => {
		const result = classifyError(new Error('Server returned 503'));
		expect(result.statusCode).toBe(503);
	});
});

// ---------------------------------------------------------------------------
// Timeout errors (retryable)
// ---------------------------------------------------------------------------

describe('classifyError — timeout errors', () => {
	it('classifies ETIMEDOUT as timeout error', () => {
		const result = classifyError(new Error('connect ETIMEDOUT'));
		expect(result.category).toBe('timeout');
		expect(result.retryable).toBe(true);
		expect(result.statusCode).toBeUndefined();
	});

	it('classifies "timeout" message as timeout error', () => {
		const result = classifyError(new Error('request timeout after 30000ms'));
		expect(result.category).toBe('timeout');
		expect(result.retryable).toBe(true);
	});

	it('classifies "Timeout" (capitalized) as timeout error', () => {
		const result = classifyError(new Error('Request Timeout'));
		expect(result.category).toBe('timeout');
		expect(result.retryable).toBe(true);
	});

	it('classifies AbortError as timeout error', () => {
		const result = classifyError(new Error('AbortError: signal timed out'));
		expect(result.category).toBe('timeout');
		expect(result.retryable).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Network errors
// ---------------------------------------------------------------------------

describe('classifyError — network errors', () => {
	it('classifies ENOTFOUND as non-retryable network error', () => {
		const result = classifyError(new Error('getaddrinfo ENOTFOUND example.com'));
		expect(result.category).toBe('network');
		expect(result.retryable).toBe(false);
	});

	it('classifies "getaddrinfo" as non-retryable network error', () => {
		const result = classifyError(new Error('getaddrinfo failed'));
		expect(result.category).toBe('network');
		expect(result.retryable).toBe(false);
	});

	it('classifies ECONNREFUSED as retryable network error', () => {
		const result = classifyError(new Error('connect ECONNREFUSED 127.0.0.1:8080'));
		expect(result.category).toBe('network');
		expect(result.retryable).toBe(true);
	});

	it('classifies ECONNRESET as retryable network error', () => {
		const result = classifyError(new Error('ECONNRESET'));
		expect(result.category).toBe('network');
		expect(result.retryable).toBe(true);
	});

	it('classifies ERR_NETWORK as retryable network error', () => {
		const result = classifyError(new Error('ERR_NETWORK'));
		expect(result.category).toBe('network');
		expect(result.retryable).toBe(true);
	});

	it('classifies "Failed to fetch" as retryable network error', () => {
		const result = classifyError(new Error('Failed to fetch'));
		expect(result.category).toBe('network');
		expect(result.retryable).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Non-Error inputs (fallback to unknown)
// ---------------------------------------------------------------------------

describe('classifyError — non-Error inputs', () => {
	it('classifies non-Error objects as unknown', () => {
		const result = classifyError({ code: 'WHAT' });
		expect(result.category).toBe('unknown');
		expect(result.retryable).toBe(false);
		expect(result.message).toBe('An unexpected error occurred.');
	});

	it('classifies string inputs as unknown', () => {
		const result = classifyError('some string error');
		expect(result.category).toBe('unknown');
		expect(result.retryable).toBe(false);
	});

	it('classifies null as unknown', () => {
		const result = classifyError(null);
		expect(result.category).toBe('unknown');
		expect(result.retryable).toBe(false);
	});

	it('classifies undefined as unknown', () => {
		const result = classifyError(undefined);
		expect(result.category).toBe('unknown');
		expect(result.retryable).toBe(false);
	});

	it('classifies number as unknown', () => {
		const result = classifyError(42);
		expect(result.category).toBe('unknown');
		expect(result.retryable).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Fallback — Error with unrecognized message
// ---------------------------------------------------------------------------

describe('classifyError — fallback', () => {
	it('falls back to unknown for unrecognized Error messages', () => {
		const result = classifyError(new Error('something completely unexpected'));
		expect(result.category).toBe('unknown');
		expect(result.retryable).toBe(false);
		expect(result.message).toBe('something completely unexpected');
	});

	it('preserves original error message in fallback', () => {
		const msg = 'Custom plugin error: widget not found';
		const result = classifyError(new Error(msg));
		expect(result.message).toBe(msg);
	});
});

// ---------------------------------------------------------------------------
// ClassifiedError shape
// ---------------------------------------------------------------------------

describe('classifyError — return shape', () => {
	it('always returns category, message, and retryable', () => {
		const inputs: unknown[] = [
			new Error('401'),
			new Error('500'),
			new Error('ETIMEDOUT'),
			new Error('ECONNREFUSED'),
			new Error('unknown'),
			'string',
			null,
		];

		for (const input of inputs) {
			const result: ClassifiedError = classifyError(input);
			expect(result).toHaveProperty('category');
			expect(result).toHaveProperty('message');
			expect(result).toHaveProperty('retryable');
			expect(typeof result.category).toBe('string');
			expect(typeof result.message).toBe('string');
			expect(typeof result.retryable).toBe('boolean');
		}
	});

	it('statusCode is only present for HTTP errors', () => {
		const httpResult = classifyError(new Error('401 Unauthorized'));
		expect(httpResult.statusCode).toBeDefined();

		const networkResult = classifyError(new Error('ECONNREFUSED'));
		expect(networkResult.statusCode).toBeUndefined();

		const unknownResult = classifyError('oops');
		expect(unknownResult.statusCode).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Priority ordering — auth before validation before server
// ---------------------------------------------------------------------------

describe('classifyError — priority ordering', () => {
	it('auth check runs before generic status code matching', () => {
		// A message with both 401 and other patterns should still be auth
		const result = classifyError(new Error('401 Unauthorized'));
		expect(result.category).toBe('auth');
	});

	it('config (404) takes priority over network patterns in same message', () => {
		const result = classifyError(new Error('Not Found'));
		expect(result.category).toBe('config');
	});
});

