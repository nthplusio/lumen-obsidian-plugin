/**
 * SyncClient — HTTP client for the Lumen server sync endpoints.
 *
 * Mirrors the ApiClient pattern for consistency:
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
	SyncManifestResponseV2,
	SyncUploadResponse,
	SyncDownloadResponse,
	PluginRegistrationResponse,
	SyncStatusResponse,
} from '../types';
import { LumenHttpClient } from '../http-client';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// SyncClient
// ---------------------------------------------------------------------------

export class SyncClient extends LumenHttpClient {
	private workspaceId: string;

	constructor(apiUrl: string, apiKey: string, workspaceId: string) {
		super(apiUrl, apiKey);
		this.workspaceId = workspaceId;
	}

	/** Swap credentials (e.g. after a settings change). */
	updateSettings(apiUrl: string, apiKey: string, workspaceId: string): void {
		this.apiUrl = apiUrl;
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
		platform: string = 'unknown',
	): Promise<PluginRegistrationResponse> {
		const url = this.buildUrl('sync/register');

		logger.debug('Registering plugin:', { deviceId, deviceName, vaultName });

		const response = await requestUrl({
			url,
			method: 'POST',
			headers: this.headers,
			body: JSON.stringify({
				device_id: deviceId,
				device_name: deviceName,
				plugin_version: pluginVersion,
				vault_name: vaultName,
				platform,
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
	// POST /sync/upload — Step 2: Upload requested files
	// -----------------------------------------------------------------------

	/**
	 * Upload file contents as multipart/form-data.
	 *
	 * Uses Obsidian's `requestUrl` with a manually constructed multipart
	 * body. We can't use native `fetch` because it's subject to CORS in
	 * Electron's renderer, and we can't pass a FormData object to
	 * `requestUrl` because it doesn't serialize boundaries correctly.
	 * Instead we build the multipart payload as an ArrayBuffer ourselves.
	 *
	 * Protocol: each file is a form part where the field name is the
	 * vault-relative path and the value is the file content.
	 *
	 * @param sessionId — sync_session_id returned from sendManifestV2()
	 * @param files — Map of vault-relative path → file content (string)
	 * @param batchIndex — zero-based index of this batch within the upload
	 * @param isLastBatch — true if this is the final batch in the upload
	 */
	async uploadFiles(
		sessionId: string,
		files: Map<string, string | ArrayBuffer>,
		batchIndex: number = 0,
		isLastBatch: boolean = true,
	): Promise<SyncUploadResponse> {
		const url = this.buildUrl('sync/upload');

		logger.debug('Uploading files:', { sessionId, fileCount: files.size });

		const boundary = `----LumenUpload${Date.now()}${Math.random().toString(36).slice(2)}`;
		const encoder = new TextEncoder();

		// Build multipart body as byte arrays
		const parts: Uint8Array[] = [];

		// Session ID as a plain form field
		const sessionHeader = `--${boundary}\r\nContent-Disposition: form-data; name="sync_session_id"\r\n\r\n${sessionId}\r\n`;
		parts.push(encoder.encode(sessionHeader));

		// Batch metadata fields
		const batchIndexHeader = `--${boundary}\r\nContent-Disposition: form-data; name="batch_index"\r\n\r\n${batchIndex}\r\n`;
		parts.push(encoder.encode(batchIndexHeader));

		const isLastBatchHeader = `--${boundary}\r\nContent-Disposition: form-data; name="is_last_batch"\r\n\r\n${isLastBatch ? 'true' : 'false'}\r\n`;
		parts.push(encoder.encode(isLastBatchHeader));

		// Each file as a file form field
		for (const [path, content] of files) {
			const isText = typeof content === 'string';
			const mimeType = isText ? 'text/plain' : 'application/octet-stream';
			// Sanitize path for Content-Disposition: replace " and \ with _ to prevent
			// header injection, strip CRLF to prevent multipart boundary attacks.
			const safePath = path.replace(/["\\]/g, '_').replace(/[\r\n]/g, '');
			const header = `--${boundary}\r\nContent-Disposition: form-data; name="${safePath}"; filename="${safePath}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
			parts.push(encoder.encode(header));

			if (isText) {
				parts.push(encoder.encode(content));
			} else {
				parts.push(new Uint8Array(content));
			}

			parts.push(encoder.encode('\r\n'));
		}

		parts.push(encoder.encode(`--${boundary}--\r\n`));

		// Concatenate all parts into a single ArrayBuffer
		const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
		const body = new Uint8Array(totalLength);
		let offset = 0;
		for (const part of parts) {
			body.set(part, offset);
			offset += part.length;
		}

		const response = await requestUrl({
			url,
			method: 'POST',
			headers: {
				'X-API-Key': this.apiKey,
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
			},
			body: body.buffer,
		});

		if (response.status < 200 || response.status >= 300) {
			throw new Error(
				`Upload failed: ${response.status} ${this.extractErrorMessage(response)}`,
			);
		}

		const result = response.json as SyncUploadResponse;
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
	// POST /sync/manifest — Step 1: Hash exchange (V2 two-way sync)
	// -----------------------------------------------------------------------

	/**
	 * Send the client file manifest with device ID and sync sequence.
	 *
	 * The server compares hashes and returns:
	 *   - `needed_files` — files the server needs uploaded
	 *   - `server_changes` — files changed on the server since last sync
	 *   - `server_deletions` — files deleted on the server
	 *   - `conflicts` — files modified on both sides
	 */
	async sendManifestV2(
		files: FileManifestEntry[],
		deviceId: string,
		lastSyncSeq: number,
		cursor?: string,
	): Promise<SyncManifestResponseV2> {
		const url = this.buildUrl('sync/manifest');

		logger.debug('Sending V2 manifest:', {
			fileCount: files.length,
			deviceId,
			lastSyncSeq,
			hasCursor: !!cursor,
		});

		const body: Record<string, unknown> = {
			files,
			protocol_version: 2,
			device_id: deviceId,
			last_sync_seq: lastSyncSeq,
		};
		if (cursor) {
			body.cursor = cursor;
		}

		const response = await requestUrl({
			url,
			method: 'POST',
			headers: this.headers,
			body: JSON.stringify(body),
		});

		if (response.status !== 200) {
			throw new Error(
				`V2 manifest exchange failed: ${response.status} ${this.extractErrorMessage(response)}`,
			);
		}

		const result = response.json as SyncManifestResponseV2;
		logger.info('V2 manifest response:', {
			sessionId: result.sync_session_id,
			neededFiles: result.needed_files.length,
			serverChanges: result.server_changes?.length ?? 0,
			serverDeletions: result.server_deletions?.length ?? 0,
			conflicts: result.conflicts?.length ?? 0,
		});

		return result;
	}

	/**
	 * Download files from the server (pull path).
	 *
	 * Called after V2 manifest indicates `server_changes`. Files are
	 * returned as base64-encoded content.
	 *
	 * BUG-3 fix: accepts optional endpoint parameter from server response
	 * instead of hardcoding the download path.
	 */
	async downloadFiles(
		sessionId: string,
		paths: string[],
		endpoint?: string,
	): Promise<SyncDownloadResponse> {
		const url = endpoint
			? `${this.baseUrl}${endpoint}`
			: this.buildUrl('sync/download');

		logger.debug('Downloading files:', { sessionId, pathCount: paths.length, endpoint: endpoint ?? '(default)' });

		const response = await requestUrl({
			url,
			method: 'POST',
			headers: this.headers,
			body: JSON.stringify({
				sync_session_id: sessionId,
				paths,
			}),
		});

		if (response.status !== 200) {
			throw new Error(
				`Download failed: ${response.status} ${this.extractErrorMessage(response)}`,
			);
		}

		return response.json as SyncDownloadResponse;
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	/** Build a full URL for a sync sub-path. */
	private buildUrl(subpath: string): string {
		return `${this.baseUrl}/api/workspaces/${this.workspaceId}/${subpath}`;
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
