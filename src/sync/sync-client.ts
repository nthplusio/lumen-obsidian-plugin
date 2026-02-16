/**
 * SyncClient — HTTP client for the Lumen server sync endpoints.
 *
 * Mirrors the McpClient pattern for consistency:
 *   - Constructor accepts credentials; updateSettings() swaps them.
 *   - Uses Obsidian's `requestUrl` for JSON requests (proper CORS in Electron).
 *   - Uses native `fetch` for multipart FormData uploads (requestUrl
 *     doesn't handle FormData boundaries correctly).
 *
 * Endpoints (all already implemented server-side in routes/sync.ts):
 *   POST /api/workspaces/:id/sync/register  — Plugin registration
 *   POST /api/workspaces/:id/sync/manifest  — Hash exchange (Step 1)
 *   POST /api/workspaces/:id/sync/upload    — File upload  (Step 2)
 *   GET  /api/workspaces/:id/sync/status    — Sync status
 */

import { requestUrl } from 'obsidian';
import type {
	FileManifestEntry,
	SyncManifestResponse,
	SyncUploadResponse,
	PluginRegistrationResponse,
	SyncStatusResponse,
} from '../types';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// SyncClient
// ---------------------------------------------------------------------------

export class SyncClient {
	private apiUrl: string;
	private apiKey: string;
	private workspaceId: string;

	constructor(apiUrl: string, apiKey: string, workspaceId: string) {
		this.apiUrl = apiUrl.replace(/\/+$/, '');
		this.apiKey = apiKey;
		this.workspaceId = workspaceId;
	}

	/** Swap credentials (e.g. after a settings change). */
	updateSettings(apiUrl: string, apiKey: string, workspaceId: string): void {
		this.apiUrl = apiUrl.replace(/\/+$/, '');
		this.apiKey = apiKey;
		this.workspaceId = workspaceId;
	}

	// -----------------------------------------------------------------------
	// POST /sync/register — One-time plugin registration
	// -----------------------------------------------------------------------

	async register(
		deviceId: string,
		deviceName: string,
		pluginVersion: string,
		vaultName: string,
	): Promise<PluginRegistrationResponse> {
		const url = this.buildUrl('sync/register');

		logger.debug('Registering plugin:', { deviceId, deviceName, vaultName });

		const response = await requestUrl({
			url,
			method: 'POST',
			headers: this.jsonHeaders(),
			body: JSON.stringify({
				device_id: deviceId,
				device_name: deviceName,
				plugin_version: pluginVersion,
				vault_name: vaultName,
			}),
		});

		if (response.status !== 201) {
			throw new Error(
				`Registration failed: ${response.status} ${this.extractErrorMessage(response)}`,
			);
		}

		logger.info('Plugin registered successfully');
		return response.json as PluginRegistrationResponse;
	}

	// -----------------------------------------------------------------------
	// POST /sync/manifest — Step 1: Hash exchange
	// -----------------------------------------------------------------------

	/**
	 * Send the client file manifest to the server.
	 *
	 * The server compares hashes and returns which files it needs uploaded.
	 * Note: sync_session_id is intentionally omitted — the server generates
	 * it (M6 security mitigation, see spec section 4.2).
	 */
	async sendManifest(
		files: FileManifestEntry[],
		cursor?: string,
	): Promise<SyncManifestResponse> {
		const url = this.buildUrl('sync/manifest');

		logger.debug('Sending manifest:', {
			fileCount: files.length,
			hasCursor: !!cursor,
		});

		const body: Record<string, unknown> = { files };
		if (cursor) {
			body.cursor = cursor;
		}

		const response = await requestUrl({
			url,
			method: 'POST',
			headers: this.jsonHeaders(),
			body: JSON.stringify(body),
		});

		if (response.status !== 200) {
			throw new Error(
				`Manifest exchange failed: ${response.status} ${this.extractErrorMessage(response)}`,
			);
		}

		const result = response.json as SyncManifestResponse;
		logger.info('Manifest response:', {
			sessionId: result.sync_session_id,
			neededFiles: result.needed_files.length,
			deletedFiles: result.deleted_files.length,
		});

		return result;
	}

	// -----------------------------------------------------------------------
	// POST /sync/upload — Step 2: Upload requested files
	// -----------------------------------------------------------------------

	/**
	 * Upload file contents as multipart/form-data.
	 *
	 * Uses native `fetch()` instead of Obsidian's `requestUrl` because
	 * requestUrl does not correctly serialize FormData boundaries.
	 *
	 * Protocol: each file is a form part where the field name is the
	 * vault-relative path and the value is the file content.
	 *
	 * @param sessionId — sync_session_id returned from sendManifest()
	 * @param files — Map of vault-relative path → file content (string)
	 */
	async uploadFiles(
		sessionId: string,
		files: Map<string, string>,
	): Promise<SyncUploadResponse> {
		const url = this.buildUrl('sync/upload');

		logger.debug('Uploading files:', { sessionId, fileCount: files.size });

		const formData = new FormData();
		formData.append('sync_session_id', sessionId);

		for (const [path, content] of files) {
			const blob = new Blob([content], { type: 'text/markdown' });
			formData.append(path, blob, path);
		}

		// Native fetch — do NOT set Content-Type header; the browser adds
		// the multipart boundary automatically.
		let response: Response;
		try {
			response = await fetch(url, {
				method: 'POST',
				headers: { 'X-API-Key': this.apiKey },
				body: formData,
			});
		} catch (err) {
			// Handle network abort (navigated away, connection dropped mid-upload)
			if (err instanceof DOMException && err.name === 'AbortError') {
				logger.error('Upload aborted (network lost or navigated away):', {
					sessionId,
					filesAttempted: files.size,
				});
				throw new Error(
					`Upload aborted: ${files.size} file(s) may have been partially sent. ` +
					'The next sync will retry.',
				);
			}
			throw err;
		}

		if (!response.ok) {
			const body = await response.text().catch(() => '');
			throw new Error(`Upload failed: ${response.status} ${body}`);
		}

		const result = (await response.json()) as SyncUploadResponse;
		logger.info('Upload complete:', {
			accepted: result.accepted,
			rejected: result.rejected,
			deduplicated: result.deduplicated,
			indexingTriggered: result.indexing_triggered,
		});

		return result;
	}

	// -----------------------------------------------------------------------
	// GET /sync/status — Poll sync / indexing status
	// -----------------------------------------------------------------------

	async getSyncStatus(): Promise<SyncStatusResponse> {
		const url = this.buildUrl('sync/status');

		const response = await requestUrl({
			url,
			method: 'GET',
			headers: { 'X-API-Key': this.apiKey },
		});

		if (response.status !== 200) {
			throw new Error(
				`Status check failed: ${response.status} ${this.extractErrorMessage(response)}`,
			);
		}

		return response.json as SyncStatusResponse;
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	/** Build a full URL for a sync sub-path. */
	private buildUrl(subpath: string): string {
		return `${this.apiUrl}/api/workspaces/${this.workspaceId}/${subpath}`;
	}

	/** Standard headers for JSON requests with API key auth. */
	private jsonHeaders(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			'X-API-Key': this.apiKey,
		};
	}

	/**
	 * Best-effort extraction of a human-readable error message from
	 * a requestUrl response (which may contain JSON or plain text).
	 */
	private extractErrorMessage(response: { text?: string; json?: unknown }): string {
		try {
			if (response.json && typeof response.json === 'object') {
				const obj = response.json as Record<string, unknown>;
				return (obj.message as string) || (obj.error as string) || '';
			}
			return response.text?.slice(0, 200) ?? '';
		} catch {
			return '';
		}
	}
}
