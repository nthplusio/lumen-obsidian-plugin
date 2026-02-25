/**
 * SyncClient unit tests.
 *
 * Tests the HTTP client for all sync endpoints:
 *   - POST /sync/register (requestUrl)
 *   - POST /sync/manifest (fetch)
 *   - POST /sync/upload (fetch with manual multipart)
 *   - POST /sync/download (fetch)
 *   - GET  /sync/status (requestUrl)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncClient } from '../../src/sync/sync-client';
import type {
	PluginRegistrationResponse,
	SyncManifestResponseV2,
	SyncUploadResponse,
	SyncDownloadResponse,
	SyncStatusResponse,
} from '../../src/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_URL = 'https://app.getlumen.dev';
const API_KEY = 'lumen_sk_test_key_abc123';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockRequestUrl = vi.hoisted(() => vi.fn());

vi.mock('obsidian', () => ({
	requestUrl: mockRequestUrl,
	Plugin: class {},
	Notice: class {},
	TFile: class {},
	Vault: class {},
	normalizePath: (p: string) => p,
	Platform: { isDesktop: true, isMobile: false },
}));

// Mock fetch for methods that use native fetch
const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
	vi.clearAllMocks();
	globalThis.fetch = mockFetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createClient(): SyncClient {
	return new SyncClient(API_KEY, WORKSPACE_ID);
}

function mockRequestUrlSuccess(status: number, json: unknown) {
	mockRequestUrl.mockResolvedValueOnce({
		status,
		json,
		text: JSON.stringify(json),
		headers: {},
		arrayBuffer: new ArrayBuffer(0),
	} as any);
}

function mockRequestUrlFailure(status: number, message: string) {
	mockRequestUrl.mockResolvedValueOnce({
		status,
		json: { error: 'ERROR', message },
		text: JSON.stringify({ error: 'ERROR', message }),
		headers: {},
		arrayBuffer: new ArrayBuffer(0),
	} as any);
}

function mockFetchSuccess(json: unknown) {
	mockFetch.mockResolvedValueOnce({
		ok: true,
		status: 200,
		json: async () => json,
		text: async () => JSON.stringify(json),
	} as Response);
}

function mockFetchFailure(status: number, message: string) {
	mockFetch.mockResolvedValueOnce({
		ok: false,
		status,
		statusText: 'Error',
		json: async () => ({ error: 'ERROR', message }),
		text: async () => JSON.stringify({ error: 'ERROR', message }),
	} as Response);
}


// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const registrationResponse: PluginRegistrationResponse = {
	api_key: 'lumen_sk_new_key_456',
	api_key_id: 'api-key-uuid-001',
	workspace_id: WORKSPACE_ID,
	sync_manifest_endpoint: `/api/workspaces/${WORKSPACE_ID}/sync/manifest`,
	max_file_size_bytes: 50 * 1024 * 1024,
	allowed_extensions: ['.md', '.pdf'],
};

const uploadResponse: SyncUploadResponse = {
	sync_session_id: '00000000-0000-4000-8000-000000000100',
	accepted: 2,
	rejected: 0,
	deduplicated: 0,
	indexing_triggered: true,
	rejected_files: [],
};

const statusResponse: SyncStatusResponse = {
	last_sync_at: '2026-02-13T10:00:00.000Z',
	cursor: 'cursor_abc123',
	file_count: 42,
	indexing_status: {
		active: false,
		progress: 1.0,
		indexed_files: 42,
		total_files: 42,
	},
	exclude_patterns: [],
	max_file_size_bytes: 50 * 1024 * 1024,
};

const manifestResponseV2: SyncManifestResponseV2 = {
	sync_session_id: '00000000-0000-4000-8000-000000000200',
	needed_files: ['notes/local-new.md'],
	deleted_files: [],
	new_cursor: 'cursor_v2_001',
	upload_endpoint: `/api/workspaces/${WORKSPACE_ID}/sync/upload`,
	current_seq: 42,
	server_changes: [
		{ path: 'notes/server-edit.md', content_hash: 'b'.repeat(64), size_bytes: 512, seq: 41 },
	],
	server_deletions: ['notes/removed-on-server.md'],
	conflicts: [
		{ path: 'notes/conflict.md', server_hash: 'c'.repeat(64), client_hash: 'd'.repeat(64), server_seq: 40 },
	],
	download_endpoint: `/api/workspaces/${WORKSPACE_ID}/sync/download`,
};

const downloadResponse: SyncDownloadResponse = {
	files: [
		{
			path: 'notes/server-edit.md',
			content_base64: btoa('# Server Edited Content'),
			content_hash: 'b'.repeat(64),
			size_bytes: 512,
		},
	],
};

// ---------------------------------------------------------------------------
// Tests: register (uses requestUrl)
// ---------------------------------------------------------------------------

describe('SyncClient', () => {
	describe('register', () => {
		it('sends correct request body and returns PluginRegistrationResponse', async () => {
			const client = createClient();
			mockRequestUrlSuccess(201, registrationResponse);

			const result = await client.register('device-uuid-001', 'MacBook Pro', '0.1.0', 'My Vault');

			expect(result).toEqual(registrationResponse);
			expect(mockRequestUrl).toHaveBeenCalledOnce();
			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.url).toBe(`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/register`);
			expect(call.method).toBe('POST');

			const body = JSON.parse(call.body);
			expect(body.device_id).toBe('device-uuid-001');
			expect(body.vault_name).toBe('My Vault');
		});

		it('throws on non-201 status', async () => {
			const client = createClient();
			mockRequestUrlFailure(400, 'device_id is required');

			await expect(client.register('', 'name', '1.0.0', 'vault'))
				.rejects.toThrow(/Registration failed.*400/);
		});
	});

	// -----------------------------------------------------------------------
	// uploadFiles (uses fetch)
	// -----------------------------------------------------------------------

	describe('uploadFiles', () => {
		it('uses fetch with manual multipart body', async () => {
			const client = createClient();
			mockFetchSuccess(uploadResponse);

			const files = new Map([
				['notes/daily.md', '# Daily Notes\n\nContent'],
				['notes/project.md', '# Project\n\nDetails'],
			]);

			await client.uploadFiles('session-123', files);

			expect(mockFetch).toHaveBeenCalledOnce();
		});

		it('encodes file paths in multipart body', async () => {
			const client = createClient();
			mockFetchSuccess(uploadResponse);

			const files = new Map([
				['notes/daily.md', '# Daily Notes'],
				['folder/subfolder/deep.md', '# Deep nested'],
			]);

			await client.uploadFiles('session-123', files);

			const [, options] = mockFetch.mock.calls[0]!;
			const bodyText = new TextDecoder().decode(new Uint8Array(options.body));
			expect(bodyText).toContain('sync_session_id');
			expect(bodyText).toContain('session-123');
			expect(bodyText).toContain('notes/daily.md');
			expect(bodyText).toContain('# Daily Notes');
			expect(bodyText).toContain('folder/subfolder/deep.md');
		});

		it('includes X-API-Key header', async () => {
			const client = createClient();
			mockFetchSuccess(uploadResponse);

			await client.uploadFiles('session-123', new Map());

			const [, options] = mockFetch.mock.calls[0]!;
			expect(options.headers['X-API-Key']).toBe(API_KEY);
		});

		it('sets Content-Type with multipart boundary', async () => {
			const client = createClient();
			mockFetchSuccess(uploadResponse);

			await client.uploadFiles('session-123', new Map());

			const [, options] = mockFetch.mock.calls[0]!;
			expect(options.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/);
		});

		it('returns SyncUploadResponse with accepted/rejected counts', async () => {
			const client = createClient();
			mockFetchSuccess(uploadResponse);

			const result = await client.uploadFiles('session-123', new Map());

			expect(result.accepted).toBe(2);
			expect(result.rejected).toBe(0);
			expect(result.indexing_triggered).toBe(true);
		});

		it('throws on non-ok response', async () => {
			const client = createClient();
			mockFetchFailure(422, 'Session expired');

			await expect(client.uploadFiles('bad-session', new Map()))
				.rejects.toThrow(/Upload failed.*422/);
		});

		it('sends to correct URL', async () => {
			const client = createClient();
			mockFetchSuccess(uploadResponse);

			await client.uploadFiles('session-123', new Map());

			const [url] = mockFetch.mock.calls[0]!;
			expect(url).toBe(`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/upload`);
		});

		it('includes batch_index and is_last_batch fields in multipart body', async () => {
			const client = createClient();
			mockFetchSuccess(uploadResponse);

			const files = new Map([['notes/test.md', '# Test']]);
			await client.uploadFiles('session-123', files, 2, false);

			const [, options] = mockFetch.mock.calls[0]!;
			const bodyText = new TextDecoder().decode(new Uint8Array(options.body));
			expect(bodyText).toContain('name="batch_index"');
			expect(bodyText).toContain('\r\n\r\n2\r\n');
			expect(bodyText).toContain('name="is_last_batch"');
			expect(bodyText).toContain('\r\n\r\nfalse\r\n');
		});

		it('defaults batchIndex=0 and isLastBatch=true when not provided', async () => {
			const client = createClient();
			mockFetchSuccess(uploadResponse);

			await client.uploadFiles('session-123', new Map());

			const [, options] = mockFetch.mock.calls[0]!;
			const bodyText = new TextDecoder().decode(new Uint8Array(options.body));
			expect(bodyText).toContain('\r\n\r\n0\r\n');
			expect(bodyText).toContain('\r\n\r\ntrue\r\n');
		});

		it('passes AbortSignal to fetch', async () => {
			const client = createClient();
			mockFetchSuccess(uploadResponse);
			const controller = new AbortController();

			await client.uploadFiles('session-123', new Map(), 0, true, controller.signal);

			const [, options] = mockFetch.mock.calls[0]!;
			expect(options.signal).toBe(controller.signal);
		});
	});

	// -----------------------------------------------------------------------
	// getSyncStatus (uses requestUrl)
	// -----------------------------------------------------------------------

	describe('getSyncStatus', () => {
		it('returns sync status response', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, statusResponse);

			const result = await client.getSyncStatus();

			expect(result.last_sync_at).toBe('2026-02-13T10:00:00.000Z');
			expect(result.file_count).toBe(42);
		});

		it('throws on non-200 status', async () => {
			const client = createClient();
			mockRequestUrlFailure(500, 'Internal server error');

			await expect(client.getSyncStatus()).rejects.toThrow(/Status check failed.*500/);
		});
	});

	// -----------------------------------------------------------------------
	// error responses
	// -----------------------------------------------------------------------

	describe('error responses', () => {
		it('includes status code in error for manifest auth failures', async () => {
			const client = createClient();
			mockFetchFailure(401, 'Unauthorized');

			await expect(client.sendManifestV2([], 'device-001', 0)).rejects.toThrow('401');
		});

		it('includes status code in error for status server errors', async () => {
			const client = createClient();
			mockRequestUrlFailure(503, 'Service unavailable');

			await expect(client.getSyncStatus()).rejects.toThrow('503');
		});

		it('upload error includes response message', async () => {
			const client = createClient();
			mockFetchFailure(413, 'File too large');

			await expect(client.uploadFiles('s', new Map()))
				.rejects.toThrow('File too large');
		});
	});

	// -----------------------------------------------------------------------
	// updateSettings
	// -----------------------------------------------------------------------

	describe('updateSettings', () => {
		it('changes auth and workspace for subsequent requests', async () => {
			const client = createClient();
			const newKey = 'lumen_sk_new_key';
			const newWorkspace = '00000000-0000-4000-8000-000000000002';

			client.updateSettings(newKey, newWorkspace);

			mockRequestUrlSuccess(200, statusResponse);
			await client.getSyncStatus();

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.url).toBe(`${API_URL}/api/workspaces/${newWorkspace}/sync/status`);
			expect(call.headers['X-API-Key']).toBe(newKey);
		});
	});

	// -----------------------------------------------------------------------
	// sendManifestV2 (uses fetch)
	// -----------------------------------------------------------------------

	describe('sendManifestV2', () => {
		it('sends V2 fields: protocol_version, device_id, last_sync_seq', async () => {
			const client = createClient();
			mockFetchSuccess(manifestResponseV2);

			const files = [{
				path: 'notes/local-new.md',
				content_hash: 'a'.repeat(64),
				modified_at: '2026-02-13T10:00:00.000Z',
				size_bytes: 256,
				action: 'add' as const,
			}];

			await client.sendManifestV2(files, 'device-001', 35, 'prev_cursor');

			const [, options] = mockFetch.mock.calls[0]!;
			const body = JSON.parse(options.body);
			expect(body.protocol_version).toBe(2);
			expect(body.device_id).toBe('device-001');
			expect(body.last_sync_seq).toBe(35);
			expect(body.cursor).toBe('prev_cursor');
			expect(body.files).toHaveLength(1);
		});

		it('omits cursor when not provided', async () => {
			const client = createClient();
			mockFetchSuccess(manifestResponseV2);

			await client.sendManifestV2([], 'device-001', 0);

			const [, options] = mockFetch.mock.calls[0]!;
			const body = JSON.parse(options.body);
			expect(body.cursor).toBeUndefined();
		});

		it('sends to /sync/manifest endpoint', async () => {
			const client = createClient();
			mockFetchSuccess(manifestResponseV2);

			await client.sendManifestV2([], 'device-001', 0);

			const [url, options] = mockFetch.mock.calls[0]!;
			expect(url).toBe(`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/manifest`);
			expect(options.method).toBe('POST');
		});

		it('includes X-API-Key and Content-Type headers', async () => {
			const client = createClient();
			mockFetchSuccess(manifestResponseV2);

			await client.sendManifestV2([], 'device-001', 0);

			const [, options] = mockFetch.mock.calls[0]!;
			expect(options.headers['X-API-Key']).toBe(API_KEY);
			expect(options.headers['Content-Type']).toBe('application/json');
		});

		it('returns V2 response with server_changes, conflicts, download_endpoint', async () => {
			const client = createClient();
			mockFetchSuccess(manifestResponseV2);

			const result = await client.sendManifestV2([], 'device-001', 35);

			expect(result.current_seq).toBe(42);
			expect(result.server_changes).toHaveLength(1);
			expect(result.server_deletions).toEqual(['notes/removed-on-server.md']);
			expect(result.conflicts).toHaveLength(1);
			expect(result.download_endpoint).toContain('/sync/download');
		});

		it('throws on non-200 status', async () => {
			const client = createClient();
			mockFetchFailure(500, 'Internal server error');

			await expect(client.sendManifestV2([], 'device-001', 0))
				.rejects.toThrow(/V2 manifest exchange failed.*500/);
		});

		it('throws on 401 (expired API key)', async () => {
			const client = createClient();
			mockFetchFailure(401, 'Unauthorized');

			await expect(client.sendManifestV2([], 'device-001', 0))
				.rejects.toThrow(/V2 manifest exchange failed.*401/);
		});

		it('passes AbortSignal to fetch', async () => {
			const client = createClient();
			mockFetchSuccess(manifestResponseV2);
			const controller = new AbortController();

			await client.sendManifestV2([], 'device-001', 0, undefined, controller.signal);

			const [, options] = mockFetch.mock.calls[0]!;
			expect(options.signal).toBe(controller.signal);
		});
	});

	// -----------------------------------------------------------------------
	// downloadFiles (uses fetch)
	// -----------------------------------------------------------------------

	describe('downloadFiles', () => {
		it('sends session ID and paths to download endpoint', async () => {
			const client = createClient();
			mockFetchSuccess(downloadResponse);

			await client.downloadFiles('session-v2', ['notes/server-edit.md']);

			const [, options] = mockFetch.mock.calls[0]!;
			expect(options.method).toBe('POST');

			const body = JSON.parse(options.body);
			expect(body.sync_session_id).toBe('session-v2');
			expect(body.paths).toEqual(['notes/server-edit.md']);
		});

		it('uses server-provided endpoint when given (BUG-3 fix)', async () => {
			const client = createClient();
			mockFetchSuccess(downloadResponse);

			const serverEndpoint = `/api/workspaces/${WORKSPACE_ID}/sync/download`;
			await client.downloadFiles('session-v2', ['notes/server-edit.md'], serverEndpoint);

			const [url] = mockFetch.mock.calls[0]!;
			expect(url).toBe(`${API_URL}${serverEndpoint}`);
		});

		it('falls back to default /sync/download when endpoint not provided', async () => {
			const client = createClient();
			mockFetchSuccess(downloadResponse);

			await client.downloadFiles('session-v2', ['notes/server-edit.md']);

			const [url] = mockFetch.mock.calls[0]!;
			expect(url).toBe(`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/download`);
		});

		it('includes X-API-Key and Content-Type headers', async () => {
			const client = createClient();
			mockFetchSuccess(downloadResponse);

			await client.downloadFiles('session-v2', ['notes/file.md']);

			const [, options] = mockFetch.mock.calls[0]!;
			expect(options.headers['X-API-Key']).toBe(API_KEY);
			expect(options.headers['Content-Type']).toBe('application/json');
		});

		it('returns files with base64 content', async () => {
			const client = createClient();
			mockFetchSuccess(downloadResponse);

			const result = await client.downloadFiles('session-v2', ['notes/server-edit.md']);

			expect(result.files).toHaveLength(1);
			expect(result.files[0]!.path).toBe('notes/server-edit.md');
			expect(result.files[0]!.content_base64).toBe(btoa('# Server Edited Content'));
		});

		it('handles multiple files in download response', async () => {
			const client = createClient();
			const multiFileResponse: SyncDownloadResponse = {
				files: [
					{ path: 'a.md', content_base64: btoa('AAA'), content_hash: 'a'.repeat(64), size_bytes: 3 },
					{ path: 'b.md', content_base64: btoa('BBB'), content_hash: 'b'.repeat(64), size_bytes: 3 },
					{ path: 'c.md', content_base64: btoa('CCC'), content_hash: 'c'.repeat(64), size_bytes: 3 },
				],
			};
			mockFetchSuccess(multiFileResponse);

			const result = await client.downloadFiles('session-v2', ['a.md', 'b.md', 'c.md']);

			expect(result.files).toHaveLength(3);
		});

		it('sends multiple paths in request body', async () => {
			const client = createClient();
			mockFetchSuccess({ files: [] });

			const paths = ['notes/a.md', 'notes/b.md', 'folder/c.md'];
			await client.downloadFiles('session-v2', paths);

			const [, options] = mockFetch.mock.calls[0]!;
			const body = JSON.parse(options.body);
			expect(body.paths).toEqual(paths);
		});

		it('throws on non-200 status', async () => {
			const client = createClient();
			mockFetchFailure(404, 'Session not found');

			await expect(client.downloadFiles('bad-session', ['notes/file.md']))
				.rejects.toThrow(/Download failed.*404/);
		});

		it('throws on server error', async () => {
			const client = createClient();
			mockFetchFailure(500, 'Internal error');

			await expect(client.downloadFiles('session-v2', ['notes/file.md']))
				.rejects.toThrow(/Download failed.*500/);
		});

		it('passes AbortSignal to fetch', async () => {
			const client = createClient();
			mockFetchSuccess(downloadResponse);
			const controller = new AbortController();

			await client.downloadFiles('session-v2', ['notes/file.md'], undefined, controller.signal);

			const [, options] = mockFetch.mock.calls[0]!;
			expect(options.signal).toBe(controller.signal);
		});
	});

	// -----------------------------------------------------------------------
	// URL construction
	// -----------------------------------------------------------------------

	describe('URL construction', () => {
		it('builds correct URL for each endpoint', async () => {
			const client = createClient();

			// Register (requestUrl)
			mockRequestUrlSuccess(201, registrationResponse);
			await client.register('d', 'n', '1.0.0', 'v');
			expect((mockRequestUrl.mock.calls[0]![0] as any).url).toBe(
				`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/register`,
			);

			// Manifest (fetch)
			mockFetchSuccess(manifestResponseV2);
			await client.sendManifestV2([], 'device-001', 0);
			expect(mockFetch.mock.calls[0]![0]).toBe(
				`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/manifest`,
			);

			// Status (requestUrl)
			mockRequestUrlSuccess(200, statusResponse);
			await client.getSyncStatus();
			expect((mockRequestUrl.mock.calls[1]![0] as any).url).toBe(
				`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/status`,
			);

			// Upload (fetch)
			mockFetchSuccess(uploadResponse);
			await client.uploadFiles('session', new Map());
			expect(mockFetch.mock.calls[1]![0]).toBe(
				`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/upload`,
			);
		});
	});
});
