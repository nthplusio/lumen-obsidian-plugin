/**
 * Error classification utility for the Lumen Obsidian plugin.
 *
 * Classifies errors into structured categories with user-facing messages
 * and retry guidance. Uses a status-code-first approach: if the error
 * has a `.status` property, that takes priority over message matching.
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

// ---------------------------------------------------------------------------
// Status code classification (takes priority over message matching)
// ---------------------------------------------------------------------------

/**
 * Extract the server's error detail from an error message like:
 *   "V2 manifest exchange failed: 400 Some server error detail"
 *
 * Returns the server detail if present and non-empty, otherwise null.
 * This preserves diagnostic information that would otherwise be lost
 * when the classifier replaces it with a generic message.
 */
function extractServerDetail(msg: string): string | null {
	// Match "failed: <status> <detail>" pattern from SyncClient error messages
	const match = msg.match(/failed:\s*\d{3}\s+(.+)/);
	if (match?.[1] && match[1].trim().length > 0) {
		return match[1].trim();
	}
	// Also check for serverMessage property content embedded in the message
	return null;
}

function classifyByStatusCode(status: number, msg: string): ClassifiedError | null {
	switch (status) {
		case 400:
			if (msg.includes('MANIFEST_TOO_LARGE') || msg.includes('10,000') || msg.includes('10000')) {
				return {
					category: 'validation',
					message: 'Too many files for sync. Add exclude patterns on the Lumen server to reduce the count.',
					retryable: false,
					statusCode: 400,
				};
			}
			return {
				category: 'validation',
				message: extractServerDetail(msg) ?? 'Invalid request. Check your data and try again.',
				retryable: false,
				statusCode: 400,
			};
		case 401:
			return {
				category: 'auth',
				message: 'Invalid or expired API key. Check your key in Settings.',
				retryable: false,
				statusCode: 401,
			};
		case 403:
			if (msg.includes('DEVICE_NOT_REGISTERED') || msg.includes('Device not registered')) {
				return {
					category: 'auth',
					message: 'Device not registered or revoked. Go to Settings → Lumen → Reset Device to re-register.',
					retryable: false,
					statusCode: 403,
				};
			}
			if (msg.includes('Plan upgrade required') || msg.includes('required_plan')) {
				return {
					category: 'auth',
					message: 'This feature requires a plan upgrade. Visit your Lumen dashboard to upgrade.',
					retryable: false,
					statusCode: 403,
				};
			}
			return {
				category: 'auth',
				message: 'Access denied. Your API key may lack the required permissions.',
				retryable: false,
				statusCode: 403,
			};
		case 404:
			return {
				category: 'config',
				message: 'Endpoint not found. Verify the server URL in Settings.',
				retryable: false,
				statusCode: 404,
			};
		case 410:
			return {
				category: 'validation',
				message: 'Sync session expired. A new sync will be started.',
				retryable: false,
				statusCode: 410,
			};
		case 413:
			if (msg.includes('STORAGE_QUOTA_EXCEEDED') || msg.includes('quota')) {
				return {
					category: 'validation',
					message: 'Workspace storage quota exceeded. Free up space or upgrade your plan.',
					retryable: false,
					statusCode: 413,
				};
			}
			return {
				category: 'validation',
				message: 'File too large for upload. Check server size limits.',
				retryable: false,
				statusCode: 413,
			};
		case 422:
			return {
				category: 'validation',
				message: 'Data validation failed. Try syncing again.',
				retryable: true,
				statusCode: 422,
			};
		case 429:
			return {
				category: 'rate-limit',
				message: 'Rate limited. Waiting before retrying...',
				retryable: true,
				statusCode: 429,
			};
		default:
			if (status >= 500 && status < 600) {
				return {
					category: 'server',
					message: 'Server error. The Lumen server may be restarting.',
					retryable: true,
					statusCode: status,
				};
			}
			return null;
	}
}

// ---------------------------------------------------------------------------
// Message-based classification (fallback when no status code)
// ---------------------------------------------------------------------------

function classifyByMessage(msg: string): ClassifiedError {
	// --- Auth errors (not retryable, need user action) ---
	if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('Authentication')) {
		return {
			category: 'auth',
			message: 'Invalid or expired API key. Check your key in Settings.',
			retryable: false,
			statusCode: 401,
		};
	}
	if (msg.includes('DEVICE_NOT_REGISTERED') || msg.includes('Device not registered')) {
		return {
			category: 'auth',
			message: 'Device not registered or revoked. Go to Settings → Lumen → Reset Device to re-register.',
			retryable: false,
			statusCode: 403,
		};
	}
	if (msg.includes('Plan upgrade required') || msg.includes('required_plan')) {
		return {
			category: 'auth',
			message: 'This feature requires a plan upgrade. Visit your Lumen dashboard to upgrade.',
			retryable: false,
			statusCode: 403,
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
			message: extractServerDetail(msg) ?? 'Invalid request. Check your data and try again.',
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
	if (msg.includes('STORAGE_QUOTA_EXCEEDED') || msg.includes('quota')) {
		return {
			category: 'validation',
			message: 'Workspace storage quota exceeded. Free up space or upgrade your plan.',
			retryable: false,
			statusCode: 413,
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
	if (msg.includes('MANIFEST_TOO_LARGE') || msg.includes('10,000') || msg.includes('10000')) {
		return {
			category: 'validation',
			message: 'Too many files for sync. Add exclude patterns on the Lumen server to reduce the count.',
			retryable: false,
			statusCode: 400,
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
	// ENOTFOUND is retryable: DNS failures are often transient (network blip, DNS cache miss)
	if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
		return {
			category: 'network',
			message: 'Server not found. Check your connection or the URL in Settings.',
			retryable: true,
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify an unknown error into a structured category.
 *
 * Uses a status-code-first approach: if the error object has a numeric
 * `.status` property, classification is based on that code. Falls back
 * to message pattern matching for errors without status codes.
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

	// Status-code-first: check for .status property set by SyncClient/ChatClient
	const status = (err as Error & { status?: number }).status;
	if (typeof status === 'number' && status > 0) {
		const result = classifyByStatusCode(status, msg);
		if (result) return result;
	}

	// Fall back to message pattern matching
	return classifyByMessage(msg);
}
