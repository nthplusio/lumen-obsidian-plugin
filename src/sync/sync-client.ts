/**
 * SyncClient -- HTTP client for the Lumen server sync endpoints.
 *
 * Uses Obsidian's `requestUrl` for all endpoints — it runs in the
 * main process and bypasses Electron CORS restrictions that cause
 * native `fetch` to fail in some environments.
 *
 * Endpoints:
 *   POST /api/workspaces/:id/sync/register  -- Plugin registration
 *   POST /api/workspaces/:id/sync/manifest  -- Hash exchange (Step 1)
 *   POST /api/workspaces/:id/sync/upload    -- File upload  (Step 2)
 *   POST /api/workspaces/:id/sync/download  -- File download (Step 3)
 *   GET  /api/workspaces/:id/sync/status    -- Sync status
 */

import { requestUrl } from 'obsidian';
import type {
	FileManifestEntry,
	ResolvedConflict,
	SyncManifestResponseV2,
	SyncUploadResponse,
	SyncDownloadResponse,
	PluginRegistrationResponse,
	SyncStatusResponse,
} from '../types';
import { WorkspaceConfirmationError, WorkspaceNameMismatchError } from '../types';
import { LumenHttpClient } from '../http-client';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// SyncClient
// ---------------------------------------------------------------------------

export class SyncClient extends LumenHttpClient {
	private workspaceId: string;

	constructor(apiKey: string, workspaceId: string, serverUrl = '') {
		super(apiKey, serverUrl);
		this.workspaceId = workspaceId;
	}

	/** Swap credentials (e.g. after a settings change). */
	updateSettings(apiKey: string, workspaceId: string, serverUrl = ''): void {
		this.apiKey = apiKey;
		this.workspaceId = workspaceId;
		this.serverUrl = serverUrl;
	}

	// -----------------------------------------------------------------------
	// POST /sync/register -- One-time plugin registration
	// -----------------------------------------------------------------------

	async register(
		deviceId: string,
		deviceName: string,
		pluginVersion: string,
		vaultName: string,
		platform: string = 'unknown',
		confirmWorkspaceName?: string,
	): Promise<PluginRegistrationResponse> {
		const url = this.buildUrl('sync/register');

		logger.debug('Registering plugin:', { deviceId, deviceName, vaultName });

		const body: Record<string, string> = {
			device_id: deviceId,
			device_name: deviceName,
			plugin_version: pluginVersion,
			vault_name: vaultName,
			platform,
		};
		if (confirmWorkspaceName) {
			body.confirm_workspace_name = confirmWorkspaceName;
		}

		let response;
		try {
			response = await requestUrl({
				url,
				method: 'POST',
				headers: this.headers,
				body: JSON.stringify(body),
			});
		} catch (err) {
			// requestUrl throws on non-2xx — check for 409 workspace confirmation
			if (err instanceof Error && 'status' in err && (err as Error & { status: number }).status === 409) {
				this.handle409(err, confirmWorkspaceName);
			}
			throw err;
		}

		if (response.status !== 201) {
			throw new Error(
				`Registration failed: ${response.status} ${this.extractErrorMessage(response)}`,
			);
		}

		logger.info('Plugin registered successfully');
		return response.json as PluginRegistrationResponse;
	}

	// -----------------------------------------------------------------------
	// POST /sync/upload -- Step 2: Upload requested files
	// -----------------------------------------------------------------------

	/**
	 * Upload file contents as multipart/form-data.
	 *
	 * Uses Obsidian's `requestUrl` with a manually constructed multipart
	 * body for reliable cross-platform connectivity (native `fetch` fails
	 * in some Electron environments due to CORS).
	 *
	 * @param sessionId -- sync_session_id returned from sendManifestV2()
	 * @param files -- Map of vault-relative path -> file content
	 * @param batchIndex -- zero-based index of this batch
	 * @param isLastBatch -- true if this is the final batch
	 * @param signal -- AbortSignal for cancellation
	 */
	async uploadFiles(
		sessionId: string,
		files: Map<string, string | ArrayBuffer>,
		batchIndex: number = 0,
		isLastBatch: boolean = true,
		signal?: AbortSignal,
	): Promise<SyncUploadResponse> {
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

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
			// Sanitize for ASCII Content-Disposition; percent-encode non-ASCII chars
			const safePath = path
				.replace(/["\\]/g, '_')
				.replace(/[\r\n]/g, '')
				.replace(/[^\x20-\x7E]/g, (ch) => encodeURIComponent(ch));
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
	// GET /sync/status -- Poll sync / indexing status
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
	// POST /sync/manifest -- Step 1: Hash exchange (V2 two-way sync)
	// -----------------------------------------------------------------------

	/**
	 * Send the client file manifest with device ID and sync sequence.
	 *
	 * Uses Obsidian's `requestUrl` for reliable cross-platform connectivity
	 * (native `fetch` fails in some Electron environments due to CORS).
	 * Abort support via pre-flight signal check.
	 */
	async sendManifestV2(
		files: FileManifestEntry[],
		deviceId: string,
		lastSyncSeq: number,
		cursor?: string,
		signal?: AbortSignal,
		resolvedConflicts?: ResolvedConflict[],
	): Promise<SyncManifestResponseV2> {
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

		const url = this.buildUrl('sync/manifest');

		logger.info('Sending V2 manifest:', {
			fileCount: files.length,
			deviceId,
			lastSyncSeq,
			hasCursor: !!cursor,
			cursorPreview: cursor ? `${cursor.slice(0, 20)}…` : '(none)',
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
		if (resolvedConflicts?.length) {
			body.resolved_conflicts = resolvedConflicts.map(c => ({
				path: c.path,
				superseded_hash: c.supersededHash,
			}));
		}

		const response = await requestUrl({
			url,
			method: 'POST',
			headers: this.headers,
			body: JSON.stringify(body),
		});

		if (response.status < 200 || response.status >= 300) {
			const serverMsg = this.extractErrorMessage(response);
			// Log full response detail — critical for diagnosing proxy/WAF blocks
			logger.error(`V2 manifest failed (${response.status}):`, serverMsg || '(no body)');
			logger.error('Manifest request context:', {
				fileCount: files.length,
				deviceId,
				lastSyncSeq,
				hasCursor: !!cursor,
				bodyBytes: JSON.stringify(body).length,
			});
			// Log raw response text for cases where JSON parsing fails (e.g. Cloudflare HTML)
			if (response.text && !serverMsg) {
				logger.error('Raw response:', response.text.slice(0, 500));
			}
			const error = new Error(
				`V2 manifest exchange failed: ${response.status} ${serverMsg}`,
			);
			(error as Error & { status: number }).status = response.status;
			(error as Error & { serverMessage?: string }).serverMessage = serverMsg;
			throw error;
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
	 * Uses Obsidian's `requestUrl` for reliable cross-platform connectivity
	 * (native `fetch` fails in some Electron environments due to CORS).
	 * Abort support via pre-flight signal check.
	 */
	async downloadFiles(
		sessionId: string,
		paths: string[],
		endpoint?: string,
		signal?: AbortSignal,
	): Promise<SyncDownloadResponse> {
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

		// Validate server-provided endpoint to prevent path injection
		if (endpoint && !endpoint.startsWith('/api/')) {
			throw new Error(`Unsafe download endpoint rejected: ${endpoint}`);
		}

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

		if (response.status < 200 || response.status >= 300) {
			const error = new Error(
				`Download failed: ${response.status} ${this.extractErrorMessage(response)}`,
			);
			(error as Error & { status: number }).status = response.status;
			throw error;
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

	/**
	 * Handle a 409 error thrown by requestUrl during registration.
	 *
	 * Obsidian's requestUrl throws on non-2xx, so we parse the error's
	 * response body to distinguish WORKSPACE_CONFIRMATION_REQUIRED
	 * from WORKSPACE_NAME_MISMATCH.
	 *
	 * Always throws — either a typed error or re-throws the original.
	 */
	private handle409(err: Error, confirmWorkspaceName?: string): never {
		let json: Record<string, unknown> = {};
		try {
			const text = 'text' in err ? String((err as Error & { text: string }).text) : '';
			json = JSON.parse(text) as Record<string, unknown>;
		} catch {
			// Response may not be JSON — fall through to re-throw original
			throw err;
		}

		const errorCode = json.error_code ?? json.code;

		if (errorCode === 'WORKSPACE_NAME_MISMATCH') {
			throw new WorkspaceNameMismatchError(
				(json.message as string) || 'Workspace name does not match',
				(json.expected as string) || '',
				(json.provided as string) || confirmWorkspaceName || '',
			);
		}

		// Default 409: WORKSPACE_CONFIRMATION_REQUIRED
		const details = (json.details ?? json) as Record<string, unknown>;
		throw new WorkspaceConfirmationError(
			(json.message as string) || 'Workspace confirmation required',
			{
				workspaceName: (details.workspace_name as string) || '',
				workspaceId: (details.workspace_id as string) || '',
				existingFileCount: (details.existing_file_count as number) || 0,
				existingSources: (details.existing_sources as string[]) || [],
				existingDeviceCount: (details.existing_device_count as number) || 0,
			},
		);
	}

}
