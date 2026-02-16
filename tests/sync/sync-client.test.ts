/**
 * SyncClient unit tests.
 *
 * Tests the HTTP client for all 4 sync endpoints:
 *   - POST /sync/register
 *   - POST /sync/manifest
 *   - POST /sync/upload (native fetch with FormData)
 *   - GET  /sync/status
 *
 * Mocks Obsidian's requestUrl (JSON endpoints) and global fetch (upload).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncClient } from '../../src/sync/sync-client';
import type {
	PluginRegistrationResponse,
	SyncManifestResponse,
	SyncUploadResponse,
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

// Mock global fetch for upload tests
const mockFetch = vi.fn<(...args: any[]) => Promise<Response>>();

beforeEach(() => {
	vi.clearAllMocks();
	// Install global fetch mock
	vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
	vi.unstubAllGlobals();
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

function mockFetchSuccess(json: unknown) {
	mockFetch.mockResolvedValueOnce({
		ok: true,
		status: 200,
		json: () => Promise.resolve(json),
		text: () => Promise.resolve(JSON.stringify(json)),
	} as Response);
}

function mockFetchFailure(status: number, body: string) {
	mockFetch.mockResolvedValueOnce({
		ok: false,
		status,
		json: () => Promise.resolve({}),
		text: () => Promise.resolve(body),
	} as Response);
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

const manifestResponse: SyncManifestResponse = {
	sync_session_id: '00000000-0000-4000-8000-000000000100',
	needed_files: ['notes/daily.md', 'notes/project.md'],
	deleted_files: [],
	new_cursor: 'cursor_abc123',
	upload_endpoint: `/api/workspaces/${WORKSPACE_ID}/sync/upload`,
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
	// sendManifest
	// -----------------------------------------------------------------------

	describe('sendManifest', () => {
		it('sends files array and cursor, returns needed_files', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, manifestResponse);

			const files = [
				{
					path: 'notes/daily.md',
					content_hash: 'a'.repeat(64),
					modified_at: '2026-02-13T10:00:00.000Z',
					size_bytes: 1024,
					action: 'add' as const,
				},
			];

			const result = await client.sendManifest(files, 'prev_cursor');

			expect(result.sync_session_id).toBeDefined();
			expect(result.needed_files).toEqual(['notes/daily.md', 'notes/project.md']);
			expect(result.new_cursor).toBe('cursor_abc123');
			expect(result.upload_endpoint).toContain('/sync/upload');

			// Verify request body
			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.url).toBe(`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/manifest`);

			const body = JSON.parse(call.body);
			expect(body.files).toHaveLength(1);
			expect(body.cursor).toBe('prev_cursor');
		});

		it('omits cursor when not provided', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, manifestResponse);

			await client.sendManifest([]);

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			const body = JSON.parse(call.body);
			expect(body.cursor).toBeUndefined();
		});

		it('includes X-API-Key header', async () => {
			const client = createClient();
			mockRequestUrlSuccess(200, manifestResponse);

			await client.sendManifest([]);

			const call = mockRequestUrl.mock.calls[0]![0] as any;
			expect(call.headers['X-API-Key']).toBe(API_KEY);
		});

		it('throws on non-200 status', async () => {
			const client = createClient();
			mockRequestUrlFailure(400, 'Validation error');

			await expect(client.sendManifest([])).rejects.toThrow(/Manifest exchange failed.*400/);
		});
	});

	// -----------------------------------------------------------------------
	// uploadFiles
	// -----------------------------------------------------------------------

	describe('uploadFiles', () => {
		it('uses native fetch with FormData (NOT requestUrl)', async () => {
			const client = createClient();
			mockFetchSuccess(uploadResponse);

			const files = new Map([
				['notes/daily.md', '# Daily Notes\n\nContent'],
				['notes/project.md', '# Project\n\nDetails'],
			]);

			await client.uploadFiles('session-123', files);

			// Should use global fetch, NOT requestUrl
			expect(mockFetch).toHaveBeenCalledOnce();
			expect(mockRequestUrl).not.toHaveBeenCalled();
		});

		it('encodes file paths as multipart field names', async () => {
			const client = createClient();
			mockFetchSuccess(uploadResponse);

			const files = new Map([
				['notes/daily.md', '# Daily Notes'],
				['folder/subfolder/deep.md', '# Deep nested'],
			]);

			await client.uploadFiles('session-123', files);

			// Inspect the FormData
			const fetchCall = mockFetch.mock.calls[0]!;
			const body = fetchCall[1]?.body as FormData;
			expect(body).toBeInstanceOf(FormData);

			// FormData should have sync_session_id + 2 file parts
			expect(body.get('sync_session_id')).toBe('session-123');
			expect(body.get('notes/daily.md')).toBeInstanceOf(Blob);
			expect(body.get('folder/subfolder/deep.md')).toBeInstanceOf(Blob);
		});

		it('includes X-API-Key header on fetch', async () => {
			const client = createClient();
			mockFetchSuccess(uploadResponse);

			await client.uploadFiles('session-123', new Map());

			const fetchCall = mockFetch.mock.calls[0]!;
			const headers = fetchCall[1]?.headers as Record<string, string>;
			expect(headers['X-API-Key']).toBe(API_KEY);
		});

		it('does NOT set Content-Type header (browser adds boundary)', async () => {
			const client = createClient();
			mockFetchSuccess(uploadResponse);

			await client.uploadFiles('session-123', new Map());

			const fetchCall = mockFetch.mock.calls[0]!;
			const headers = fetchCall[1]?.headers as Record<string, string>;
			expect(headers['Content-Type']).toBeUndefined();
		});

		it('returns SyncUploadResponse with accepted/rejected counts', async () => {
			const client = createClient();
			mockFetchSuccess(uploadResponse);

			const result = await client.uploadFiles('session-123', new Map());

			expect(result.accepted).toBe(2);
			expect(result.rejected).toBe(0);
			expect(result.deduplicated).toBe(0);
			expect(result.indexing_triggered).toBe(true);
			expect(result.rejected_files).toEqual([]);
		});

		it('throws on non-ok response', async () => {
			const client = createClient();
			mockFetchFailure(422, 'Session expired');

			await expect(
				client.uploadFiles('bad-session', new Map()),
			).rejects.toThrow(/Upload failed.*422/);
		});

		it('sends to correct URL', async () => {
			const client = createClient();
			mockFetchSuccess(uploadResponse);

			await client.uploadFiles('session-123', new Map());

			const fetchCall = mockFetch.mock.calls[0]!;
			expect(fetchCall[0]).toBe(`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/upload`);
			expect(fetchCall[1]?.method).toBe('POST');
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

			await expect(client.sendManifest([])).rejects.toThrow('401');
		});

		it('includes status code in error for server errors', async () => {
			const client = createClient();
			mockRequestUrlFailure(503, 'Service unavailable');

			await expect(client.getSyncStatus()).rejects.toThrow('503');
		});

		it('upload error includes response body', async () => {
			const client = createClient();
			mockFetchFailure(413, 'File too large');

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

			// Manifest
			mockRequestUrlSuccess(200, manifestResponse);
			await client.sendManifest([]);
			expect((mockRequestUrl.mock.calls[1]![0] as any).url).toBe(
				`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/manifest`,
			);

			// Status
			mockRequestUrlSuccess(200, statusResponse);
			await client.getSyncStatus();
			expect((mockRequestUrl.mock.calls[2]![0] as any).url).toBe(
				`${API_URL}/api/workspaces/${WORKSPACE_ID}/sync/status`,
			);

			// Upload (uses fetch)
			mockFetchSuccess(uploadResponse);
			await client.uploadFiles('session', new Map());
			expect(mockFetch.mock.calls[0]![0]).toBe(
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
