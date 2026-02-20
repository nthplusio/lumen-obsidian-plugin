/**
 * Error classification utility for the Lumen Obsidian plugin.
 *
 * Extracts and generalizes the error classification logic originally
 * embedded in search-view.ts so both search and sync code can reuse it.
 */

/** High-level error category */
export type ErrorCategory = 'network' | 'auth' | 'server' | 'timeout' | 'validation' | 'rate-limit' | 'config' | 'unknown';

/** Classified error with user-facing message and retry guidance */
export interface ClassifiedError {
	category: ErrorCategory;
	message: string;
	retryable: boolean;
	/** HTTP status code if applicable */
	statusCode?: number;
}

/**
 * Classify an unknown error into a structured category.
 *
 * Pattern-matches on error messages and HTTP status codes to determine
 * the error type, whether it's retryable, and what message to show.
 */
export function classifyError(err: unknown): ClassifiedError {
	if (!(err instanceof Error)) {
		return {
			category: 'unknown',
			message: 'An unexpected error occurred.',
			retryable: false,
		};
	}

	const msg = err.message;

	// --- Auth errors (not retryable, need user action) ---
	if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('Authentication')) {
		return {
			category: 'auth',
			message: 'Invalid or expired API key. Check your key in Settings.',
			retryable: false,
			statusCode: 401,
		};
	}
	if (msg.includes('403') || msg.includes('Forbidden')) {
		return {
			category: 'auth',
			message: 'Access denied. Your API key may lack the required permissions.',
			retryable: false,
			statusCode: 403,
		};
	}

	// --- Validation errors (not retryable) ---
	if (msg.includes('400') || msg.includes('Bad Request') || msg.includes('VALIDATION_ERROR')) {
		return {
			category: 'validation',
			message: 'Invalid request. Check your data and try again.',
			retryable: false,
			statusCode: 400,
		};
	}
	if (msg.includes('404') || msg.includes('Not Found')) {
		return {
			category: 'config',
			message: 'Endpoint not found. Verify the server URL in Settings.',
			retryable: false,
			statusCode: 404,
		};
	}
	if (msg.includes('410') || msg.includes('SYNC_SESSION_EXPIRED')) {
		return {
			category: 'validation',
			message: 'Sync session expired. A new sync will be started.',
			retryable: false,
			statusCode: 410,
		};
	}
	if (msg.includes('413') || msg.includes('Too Large') || msg.includes('FILE_TOO_LARGE')) {
		return {
			category: 'validation',
			message: 'File too large for upload. Check server size limits.',
			retryable: false,
			statusCode: 413,
		};
	}
	if (msg.includes('422') || msg.includes('HASH_MISMATCH')) {
		return {
			category: 'validation',
			message: 'Data validation failed. Try syncing again.',
			retryable: true,
			statusCode: 422,
		};
	}

	// --- Rate limiting (retryable with backoff) ---
	if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Too Many') || msg.includes('RATE_LIMIT')) {
		return {
			category: 'rate-limit',
			message: 'Rate limited. Waiting before retrying...',
			retryable: true,
			statusCode: 429,
		};
	}

	// --- Server errors (retryable) ---
	if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) {
		return {
			category: 'server',
			message: 'Server error. The Lumen server may be restarting.',
			retryable: true,
			statusCode: parseInt(msg.match(/5\d{2}/)?.[0] ?? '500', 10),
		};
	}

	// --- Timeout errors (retryable) ---
	if (msg.includes('ETIMEDOUT') || msg.includes('timeout') || msg.includes('Timeout') || msg.includes('AbortError')) {
		return {
			category: 'timeout',
			message: 'Request timed out. The server may be busy.',
			retryable: true,
		};
	}

	// --- Network errors ---
	if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
		return {
			category: 'network',
			message: 'Server not found. Check the URL in Settings.',
			retryable: false,
		};
	}
	if (msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET') || msg.includes('ERR_NETWORK') || msg.includes('Failed to fetch')) {
		return {
			category: 'network',
			message: 'Could not connect to server. It may be down or unreachable.',
			retryable: true,
		};
	}

	// --- Fallback ---
	return {
		category: 'unknown',
		message: msg,
		retryable: false,
	};
}

/**
 * Check whether an HTTP status code indicates a retryable error.
 */
export function isRetryableStatus(status: number): boolean {
	return status === 429 || status === 502 || status === 503 || status === 504;
}
