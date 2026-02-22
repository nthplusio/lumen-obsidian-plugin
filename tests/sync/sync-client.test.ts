/**
 * SyncClient unit tests.
 *
 * Tests the HTTP client for all 4 sync endpoints:
 *   - POST /sync/register
 *   - POST /sync/manifest
 *   - POST /sync/upload (requestUrl with manual multipart body)
 *   - GET  /sync/status
 *
 * All endpoints use Obsidian's requestUrl (mocked).
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

const API_URL = 'https://app.getlumen.io';
const API_KEY = 'lumen_sk_test_key_abc123';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

// Hoist the mock fn so it's available for vi.mock factory
const mockRequestUrl = vi.hoisted(() => vi.fn());

// Replace the obsidian module's requestUrl with our spy
vi.mock('obsidian', () => ({
	requestUrl: mockRequestUrl,
	Plugin: class {},
	Notice: class {},
	TFile: class {},
	Vault: class {},
	normalizePath: (p: string) => p,
	Platform: { isDesktop: true, isMobile: false },
}));

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createClient(): SyncClient {
	return new SyncClient(API_URL, API_KEY, WORKSPACE_ID);
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


// ---------------------------------------------------------------------------
// Registration Response Fixtures
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
// Tests: register
// ---------------------------------------------------------------------------

describe('SyncClient', () => {
	describe('register', () => {
		it('sends correct request body and returns PluginRegistrationResponse', async () => {
			const client = createClient();
			mockRequestUrlSuccess(201, registrationResponse);

			const result = await client.register(
				'device-uuid-001',
				'MacBook Pro',
				'0.1.0',
				'My Vault',
			);

			expect(result).toEqual(registrationResponse);
			expect(result.api_key).toBe('lumen_sk_new_key_456');
			expect(result.workspace_id).toBe(WORKSPACE_ID);
			expect(result.allowed_extensions).toContain('.md');

			// Verify request structure
			expect(mockRequestUrl).toHaveBeenCalledOnce();
			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.url).toBe(`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/register`);
			expect(call.method).toBe('POST');

			const body = JSON.parse(call.body);
			expect(body.device_id).toBe('device-uuid-001');
			expect(body.device_name).toBe('MacBook Pro');
			expect(body.plugin_version).toBe('0.1.0');
			expect(body.vault_name).toBe('My Vault');
		});

		it('includes X-API-Key header', async () => {
			const client = createClient();
			mockRequestUrlSuccess(201, registrationResponse);

			await client.register('d', 'n', '1.0.0', 'v');

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.headers['X-API-Key']).toBe(API_KEY);
		});

		it('includes Content-Type: application/json header', async () => {
			const client = createClient();
			mockRequestUrlSuccess(201, registrationResponse);

			await client.register('d', 'n', '1.0.0', 'v');

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.headers['Content-Type']).toBe('application/json');
		});

		it('throws on non-201 status', async () => {
			const client = createClient();
			mockRequestUrlFailure(400, 'device_id is required');

			await expect(
				client.register('', 'name', '1.0.0', 'vault'),
			).rejects.toThrow(/Registration failed.*400/);
		});

		it('throws on 404 (workspace not found)', async () => {
			const client = createClient();
			mockRequestUrlFailure(404, 'Workspace not found');

			await expect(
				client.register('d', 'n', '1.0.0', 'v'),
			).rejects.toThrow(/Registration failed.*404/);
		});
	});

	// -----------------------------------------------------------------------
	// uploadFiles
	// -----------------------------------------------------------------------

	describe('uploadFiles', () => {
		it('uses requestUrl with manual multipart body', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, uploadResponse);

			const files = new Map([
				['notes/daily.md', '# Daily Notes\n\nContent'],
				['notes/project.md', '# Project\n\nDetails'],
			]);

			await client.uploadFiles('session-123', files);

			expect(mockRequestUrl).toHaveBeenCalledOnce();
		});

		it('encodes file paths in multipart body', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, uploadResponse);

			const files = new Map([
				['notes/daily.md', '# Daily Notes'],
				['folder/subfolder/deep.md', '# Deep nested'],
			]);

			await client.uploadFiles('session-123', files);

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			// Body is an ArrayBuffer — decode to check content
			const bodyText = new TextDecoder().decode(call.body);
			expect(bodyText).toContain('sync_session_id');
			expect(bodyText).toContain('session-123');
			expect(bodyText).toContain('notes/daily.md');
			expect(bodyText).toContain('# Daily Notes');
			expect(bodyText).toContain('folder/subfolder/deep.md');
			expect(bodyText).toContain('# Deep nested');
		});

		it('includes X-API-Key header', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, uploadResponse);

			await client.uploadFiles('session-123', new Map());

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.headers['X-API-Key']).toBe(API_KEY);
		});

		it('sets Content-Type with multipart boundary', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, uploadResponse);

			await client.uploadFiles('session-123', new Map());

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/);
		});

		it('returns SyncUploadResponse with accepted/rejected counts', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, uploadResponse);

			const result = await client.uploadFiles('session-123', new Map());

			expect(result.accepted).toBe(2);
			expect(result.rejected).toBe(0);
			expect(result.deduplicated).toBe(0);
			expect(result.indexing_triggered).toBe(true);
			expect(result.rejected_files).toEqual([]);
		});

		it('throws on non-ok response', async () => {
			const client = createClient();
			mockRequestUrlFailure(422, 'Session expired');

			await expect(
				client.uploadFiles('bad-session', new Map()),
			).rejects.toThrow(/Upload failed.*422/);
		});

		it('sends to correct URL', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, uploadResponse);

			await client.uploadFiles('session-123', new Map());

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.url).toBe(`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/upload`);
			expect(call.method).toBe('POST');
		});

		it('includes batch_index and is_last_batch fields in multipart body', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, uploadResponse);

			const files = new Map([
				['notes/test.md', '# Test'],
			]);

			await client.uploadFiles('session-123', files, 2, false);

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			const bodyText = new TextDecoder().decode(call.body);
			expect(bodyText).toContain('name="batch_index"');
			expect(bodyText).toContain('\r\n\r\n2\r\n');
			expect(bodyText).toContain('name="is_last_batch"');
			expect(bodyText).toContain('\r\n\r\nfalse\r\n');
		});

		it('defaults batchIndex=0 and isLastBatch=true when not provided', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, uploadResponse);

			await client.uploadFiles('session-123', new Map());

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			const bodyText = new TextDecoder().decode(call.body);
			expect(bodyText).toContain('name="batch_index"');
			expect(bodyText).toContain('\r\n\r\n0\r\n');
			expect(bodyText).toContain('name="is_last_batch"');
			expect(bodyText).toContain('\r\n\r\ntrue\r\n');
		});
	});

	// -----------------------------------------------------------------------
	// getSyncStatus
	// -----------------------------------------------------------------------

	describe('getSyncStatus', () => {
		it('returns sync status response', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, statusResponse);

			const result = await client.getSyncStatus();

			expect(result.last_sync_at).toBe('2026-02-13T10:00:00.000Z');
			expect(result.cursor).toBe('cursor_abc123');
			expect(result.file_count).toBe(42);
			expect(result.indexing_status.active).toBe(false);
			expect(result.indexing_status.progress).toBe(1.0);
		});

		it('includes X-API-Key header', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, statusResponse);

			await client.getSyncStatus();

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.headers['X-API-Key']).toBe(API_KEY);
		});

		it('uses GET method', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, statusResponse);

			await client.getSyncStatus();

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.method).toBe('GET');
		});

		it('throws on non-200 status', async () => {
			const client = createClient();
			mockRequestUrlFailure(500, 'Internal server error');

			await expect(client.getSyncStatus()).rejects.toThrow(/Status check failed.*500/);
		});
	});

	// -----------------------------------------------------------------------
	// Error classification — verify error messages contain status codes
	// -----------------------------------------------------------------------

	describe('error responses', () => {
		it('includes status code in error for network auth failures', async () => {
			const client = createClient();
			mockRequestUrlFailure(401, 'Unauthorized');

			await expect(client.sendManifestV2([], 'device-001', 0)).rejects.toThrow('401');
		});

		it('includes status code in error for server errors', async () => {
			const client = createClient();
			mockRequestUrlFailure(503, 'Service unavailable');

			await expect(client.getSyncStatus()).rejects.toThrow('503');
		});

		it('upload error includes response message', async () => {
			const client = createClient();
			mockRequestUrlFailure(413, 'File too large');

			await expect(
				client.uploadFiles('s', new Map()),
			).rejects.toThrow('File too large');
		});
	});

	// -----------------------------------------------------------------------
	// updateSettings
	// -----------------------------------------------------------------------

	describe('updateSettings', () => {
		it('changes endpoint URL and auth for subsequent requests', async () => {
			const client = createClient();

			const newUrl = 'https://new.getlumen.io';
			const newKey = 'lumen_sk_new_key';
			const newWorkspace = '00000000-0000-4000-8000-000000000002';

			client.updateSettings(newUrl, newKey, newWorkspace);

			mockRequestUrlSuccess(200, statusResponse);
			await client.getSyncStatus();

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.url).toBe(`${newUrl}/api/workspaces/${newWorkspace}/sync/status`);
			expect(call.headers['X-API-Key']).toBe(newKey);
		});

		it('strips trailing slashes from URL', async () => {
			const client = createClient();
			client.updateSettings('https://example.com///', 'key', 'ws');

			mockRequestUrlSuccess(200, statusResponse);
			await client.getSyncStatus();

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.url).toMatch(/^https:\/\/example\.com\/api\//);
			expect(call.url).not.toContain('///');
		});
	});

	// -----------------------------------------------------------------------
	// sendManifestV2 (V2 two-way sync)
	// -----------------------------------------------------------------------

	describe('sendManifestV2', () => {
		it('sends V2 fields: protocol_version, device_id, last_sync_seq', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, manifestResponseV2);

			const files = [
				{
					path: 'notes/local-new.md',
					content_hash: 'a'.repeat(64),
					modified_at: '2026-02-13T10:00:00.000Z',
					size_bytes: 256,
					action: 'add' as const,
				},
			];

			await client.sendManifestV2(files, 'device-001', 35, 'prev_cursor');

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			const body = JSON.parse(call.body);
			expect(body.protocol_version).toBe(2);
			expect(body.device_id).toBe('device-001');
			expect(body.last_sync_seq).toBe(35);
			expect(body.cursor).toBe('prev_cursor');
			expect(body.files).toHaveLength(1);
		});

		it('omits cursor when not provided', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, manifestResponseV2);

			await client.sendManifestV2([], 'device-001', 0);

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			const body = JSON.parse(call.body);
			expect(body.cursor).toBeUndefined();
		});

		it('sends to /sync/manifest endpoint (same as V1)', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, manifestResponseV2);

			await client.sendManifestV2([], 'device-001', 0);

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.url).toBe(`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/manifest`);
			expect(call.method).toBe('POST');
		});

		it('includes X-API-Key and Content-Type headers', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, manifestResponseV2);

			await client.sendManifestV2([], 'device-001', 0);

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.headers['X-API-Key']).toBe(API_KEY);
			expect(call.headers['Content-Type']).toBe('application/json');
		});

		it('returns V2 response with server_changes, conflicts, download_endpoint', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, manifestResponseV2);

			const result = await client.sendManifestV2([], 'device-001', 35);

			expect(result.current_seq).toBe(42);
			expect(result.server_changes).toHaveLength(1);
			expect(result.server_changes[0]!.path).toBe('notes/server-edit.md');
			expect(result.server_deletions).toEqual(['notes/removed-on-server.md']);
			expect(result.conflicts).toHaveLength(1);
			expect(result.conflicts[0]!.path).toBe('notes/conflict.md');
			expect(result.download_endpoint).toContain('/sync/download');
			// V1 fields still present
			expect(result.needed_files).toEqual(['notes/local-new.md']);
			expect(result.sync_session_id).toBeDefined();
		});

		it('throws on non-200 status', async () => {
			const client = createClient();
			mockRequestUrlFailure(500, 'Internal server error');

			await expect(
				client.sendManifestV2([], 'device-001', 0),
			).rejects.toThrow(/V2 manifest exchange failed.*500/);
		});

		it('throws on 401 (expired API key)', async () => {
			const client = createClient();
			mockRequestUrlFailure(401, 'Unauthorized');

			await expect(
				client.sendManifestV2([], 'device-001', 0),
			).rejects.toThrow(/V2 manifest exchange failed.*401/);
		});
	});

	// -----------------------------------------------------------------------
	// downloadFiles (V2 pull path, BUG-3 fix)
	// -----------------------------------------------------------------------

	describe('downloadFiles', () => {
		it('sends session ID and paths to download endpoint', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, downloadResponse);

			await client.downloadFiles('session-v2', ['notes/server-edit.md']);

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.method).toBe('POST');

			const body = JSON.parse(call.body);
			expect(body.sync_session_id).toBe('session-v2');
			expect(body.paths).toEqual(['notes/server-edit.md']);
		});

		it('uses server-provided endpoint when given (BUG-3 fix)', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, downloadResponse);

			const serverEndpoint = `/api/workspaces/${WORKSPACE_ID}/sync/download`;
			await client.downloadFiles('session-v2', ['notes/server-edit.md'], serverEndpoint);

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.url).toBe(`${API_URL}${serverEndpoint}`);
		});

		it('falls back to default /sync/download when endpoint not provided', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, downloadResponse);

			await client.downloadFiles('session-v2', ['notes/server-edit.md']);

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.url).toBe(`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/download`);
		});

		it('includes X-API-Key and Content-Type headers', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, downloadResponse);

			await client.downloadFiles('session-v2', ['notes/file.md']);

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.headers['X-API-Key']).toBe(API_KEY);
			expect(call.headers['Content-Type']).toBe('application/json');
		});

		it('returns files with base64 content', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, downloadResponse);

			const result = await client.downloadFiles('session-v2', ['notes/server-edit.md']);

			expect(result.files).toHaveLength(1);
			expect(result.files[0]!.path).toBe('notes/server-edit.md');
			expect(result.files[0]!.content_base64).toBe(btoa('# Server Edited Content'));
			expect(result.files[0]!.content_hash).toBe('b'.repeat(64));
			expect(result.files[0]!.size_bytes).toBe(512);
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
			mockRequestUrlSuccess(200, multiFileResponse);

			const result = await client.downloadFiles('session-v2', ['a.md', 'b.md', 'c.md']);

			expect(result.files).toHaveLength(3);
			expect(result.files.map(f => f.path)).toEqual(['a.md', 'b.md', 'c.md']);
		});

		it('sends multiple paths in request body', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, { files: [] });

			const paths = ['notes/a.md', 'notes/b.md', 'folder/c.md'];
			await client.downloadFiles('session-v2', paths);

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			const body = JSON.parse(call.body);
			expect(body.paths).toEqual(paths);
		});

		it('throws on non-200 status', async () => {
			const client = createClient();
			mockRequestUrlFailure(404, 'Session not found');

			await expect(
				client.downloadFiles('bad-session', ['notes/file.md']),
			).rejects.toThrow(/Download failed.*404/);
		});

		it('throws on server error', async () => {
			const client = createClient();
			mockRequestUrlFailure(500, 'Internal error');

			await expect(
				client.downloadFiles('session-v2', ['notes/file.md']),
			).rejects.toThrow(/Download failed.*500/);
		});
	});

	// -----------------------------------------------------------------------
	// URL construction
	// -----------------------------------------------------------------------

	describe('URL construction', () => {
		it('builds correct URL for each endpoint', async () => {
			const client = createClient();

			// Register
			mockRequestUrlSuccess(201, registrationResponse);
			await client.register('d', 'n', '1.0.0', 'v');
			expect((mockRequestUrl.mock.calls[0]![0] as any).url).toBe(
				`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/register`,
			);

			// Manifest (V2)
			mockRequestUrlSuccess(200, manifestResponseV2);
			await client.sendManifestV2([], 'device-001', 0);
			expect((mockRequestUrl.mock.calls[1]![0] as any).url).toBe(
				`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/manifest`,
			);

			// Status
			mockRequestUrlSuccess(200, statusResponse);
			await client.getSyncStatus();
			expect((mockRequestUrl.mock.calls[2]![0] as any).url).toBe(
				`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/status`,
			);

			// Upload (uses requestUrl with manual multipart)
			mockRequestUrlSuccess(200, uploadResponse);
			await client.uploadFiles('session', new Map());
			expect((mockRequestUrl.mock.calls[3]![0] as any).url).toBe(
				`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/upload`,
			);
		});

		it('handles URL with trailing slash', async () => {
			const client = new SyncClient('https://app.getlumen.io/', API_KEY, WORKSPACE_ID);
			mockRequestUrlSuccess(200, statusResponse);
			await client.getSyncStatus();

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			// Should not have double slashes
			expect(call.url).toBe(`https://app.getlumen.io/api/workspaces/${WORKSPACE_ID}/sync/status`);
		});
	});
});
