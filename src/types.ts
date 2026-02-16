/**
 * Type definitions for the Lumen Obsidian plugin.
 *
 * These mirror the response shapes from the Lumen MCP endpoint
 * and the sync API contracts from @lumen/shared.
 */

// ============================================================================
// Plugin Settings
// ============================================================================

/** Plugin settings persisted to data.json */
export interface LumenSettings {
	apiUrl: string;
	apiKey: string;
	// Sync configuration
	syncEnabled: boolean;
	autoSyncInterval: number; // minutes (0 = manual only)
	eventSyncEnabled: boolean; // sync on idle after vault changes
	excludePatterns: string[];
	workspaceId: string;
	deviceId: string;
	lastSyncCursor: string;
	lastSyncAt: string;
	debugMode: boolean;
}

export const DEFAULT_SETTINGS: LumenSettings = {
	apiUrl: '',
	apiKey: '',
	syncEnabled: false,
	autoSyncInterval: 5,
	eventSyncEnabled: true,
	excludePatterns: ['.obsidian/', '.trash/'],
	workspaceId: '',
	deviceId: '',
	lastSyncCursor: '',
	lastSyncAt: '',
	debugMode: false,
};

// ============================================================================
// Sync State Machine
// ============================================================================

/** Sync engine states */
export type SyncState = 'idle' | 'hashing' | 'manifest' | 'uploading' | 'success' | 'error';

/** Result returned after a sync completes (or fails) */
export interface SyncResult {
	success: boolean;
	filesUploaded: number;
	filesDeleted: number;
	errors: string[];
	duration: number;
	conflicts?: ConflictEntry[];
}

/** Entry describing a single conflict detected during sync */
export interface ConflictEntry {
	path: string;
	type: 'server-modified' | 'local-modified' | 'both-modified';
	localHash: string;
	serverHash: string;
	resolution: 'server-kept' | 'local-kept';
}

/** Progress callback for sync status updates */
export type SyncProgressCallback = (
	state: SyncState,
	progress?: { current: number; total: number; message?: string },
) => void;

// ============================================================================
// Sync API Types (mirrors @lumen/shared/storage.ts)
// ============================================================================

/** A single file entry in the sync manifest */
export interface FileManifestEntry {
	path: string;
	content_hash: string; // SHA-256 (64-char hex)
	modified_at: string; // ISO 8601
	size_bytes: number;
	action: 'add' | 'modify' | 'delete';
}

/** Server response to a manifest exchange */
export interface SyncManifestResponse {
	sync_session_id: string;
	needed_files: string[];
	deleted_files: string[];
	new_cursor: string;
	upload_endpoint: string;
}

/** Server response to a file upload */
export interface SyncUploadResponse {
	sync_session_id: string;
	accepted: number;
	rejected: number;
	deduplicated: number;
	indexing_triggered: boolean;
	rejected_files: Array<{
		path: string;
		reason: string;
	}>;
}

/** Server response to plugin registration */
export interface PluginRegistrationResponse {
	api_key: string;
	api_key_id: string;
	workspace_id: string;
	sync_manifest_endpoint: string;
	max_file_size_bytes: number;
	allowed_extensions: string[];
}

/** Server response to sync status query */
export interface SyncStatusResponse {
	last_sync_at: string | null;
	cursor: string | null;
	file_count: number;
	indexing_status: {
		active: boolean;
		progress: number;
		indexed_files: number;
		total_files: number;
	};
}

/** Options for similar document search */
export interface SimilarDocumentOptions {
	limit?: number;
}

/** A single search result from semantic_search (mirrors @lumen/shared SearchResult) */
export interface SearchResult {
	content: string;
	source_path: string;
	heading_hierarchy: string[];
	score: number;
	outgoing_links: string[];
	frontmatter: Record<string, unknown>;
	chunk_index: number;
	matching_chunks?: number;
}

/** Server status from GET /health */
export interface ServerStatus {
	status: string;
	timestamp?: string;
	version: string;
	uptime_seconds: number;
	components: Array<{ name: string; status: string; message?: string; latency_ms?: number }>;
	chunk_count: number;
	workspace_id?: string;
}

/** Document context from get_document_context */
export interface DocumentContext {
	path: string;
	title: string;
	tags: string[];
	links: string[];
	backlinks: string[];
	sections: Array<{
		heading: string;
		level: number;
		content?: string;
	}>;
}
