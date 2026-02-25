/**
 * Base HTTP client for Lumen API endpoints.
 *
 * Provides shared credential management, URL normalization, and headers
 * for ApiClient, ChatClient, and SyncClient.
 *
 * The API URL is baked in as LUMEN_API_URL — not user-configurable.
 */

import { LUMEN_API_URL } from './types';

/** Abstract base for all Lumen HTTP clients */
export abstract class LumenHttpClient {
	protected apiKey: string;

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	/** Base URL (baked-in constant, trailing slashes stripped) */
	protected get baseUrl(): string {
		return LUMEN_API_URL.replace(/\/+$/, '');
	}

	/** Common headers for authenticated JSON requests */
	protected get headers(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			'X-API-Key': this.apiKey,
		};
	}
}
