/**
 * Base HTTP client for Lumen API endpoints.
 *
 * Provides shared credential management, URL normalization, and headers
 * for ApiClient, ChatClient, and SyncClient.
 */

/** Abstract base for all Lumen HTTP clients */
export abstract class LumenHttpClient {
	protected apiUrl: string;
	protected apiKey: string;

	constructor(apiUrl: string, apiKey: string) {
		this.apiUrl = apiUrl;
		this.apiKey = apiKey;
	}

	/** Normalize base URL (strip trailing slashes) */
	protected get baseUrl(): string {
		return this.apiUrl.replace(/\/+$/, '');
	}

	/** Common headers for authenticated JSON requests */
	protected get headers(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			'X-API-Key': this.apiKey,
		};
	}
}
