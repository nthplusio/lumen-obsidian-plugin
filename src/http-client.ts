/**
 * Base HTTP client for Lumen API endpoints.
 *
 * Provides shared credential management, URL normalization, and headers
 * for ApiClient, ChatClient, and SyncClient.
 *
 * The API URL defaults to LUMEN_API_URL but can be overridden via
 * the serverUrl constructor parameter (for staging/dev environments).
 */

import { LUMEN_API_URL } from './types';

/** Abstract base for all Lumen HTTP clients */
export abstract class LumenHttpClient {
	protected apiKey: string;
	protected serverUrl: string;

	constructor(apiKey: string, serverUrl = '') {
		this.apiKey = apiKey;
		this.serverUrl = serverUrl;
	}

	/** Base URL (custom override or production default, trailing slashes stripped) */
	protected get baseUrl(): string {
		const url = this.serverUrl || LUMEN_API_URL;
		return url.replace(/\/+$/, '');
	}

	/** Common headers for authenticated JSON requests */
	protected get headers(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			'X-API-Key': this.apiKey,
		};
	}
}
