/**
 * Type definitions for the Lumen Obsidian plugin.
 *
 * These mirror the response shapes from the Lumen MCP endpoint
 * and the sync API contracts from @lumen/shared.
 */

// ============================================================================
// Plugin Constants
// ============================================================================

/** Production API URL — used when no custom server URL is configured */
export const LUMEN_API_URL = 'https://app.getlumen.io';

// ============================================================================
// Plugin Settings (persisted locally to data.json)
// ============================================================================

/** Plugin settings persisted to data.json — only locally-owned values */
export interface LumenSettings {
	apiKey: string;
	workspaceId: string;
	deviceId: string;
	lastSyncCursor: string;
	lastSyncSeq: number;
	lastSyncAt: string;
	debugMode: boolean;
	serverUrl: string;
}

export const DEFAULT_SETTINGS: LumenSettings = {
	apiKey: '',
	workspaceId: '',
	deviceId: '',
	lastSyncCursor: '',
	lastSyncSeq: 0,
	lastSyncAt: '',
	debugMode: false,
	serverUrl: '',
};

// ============================================================================
// Sync State Machine
// ============================================================================

/** Sync engine states */
export type SyncState = 'idle' | 'hashing' | 'manifest' | 'uploading' | 'downloading' | 'resolving-conflicts' | 'success' | 'error' | 'offline' | 'cancelled';

/** Result returned after a sync completes (or fails) */
export interface SyncResult {
	success: boolean;
	filesUploaded: number;
	filesDownloaded: number;
	filesDeleted: number;
	filesSkipped: number;
	filesRejected: number;
	errors: string[];
	duration: number;
	conflicts?: ConflictEntry[];
	conflictCopyPaths?: Map<string, string>;
	batchCount?: number;
}

/** Entry describing a single conflict detected during sync */
export interface ConflictEntry {
	path: string;
	type: 'server-modified' | 'local-modified' | 'both-modified';
	localHash: string;
	serverHash: string;
	resolution: 'server-kept' | 'local-kept' | 'both-kept';
	conflictCopyPath?: string;
}

/** A conflict that was resolved locally and should be reported to the server */
export interface ResolvedConflict {
	path: string;
	supersededHash: string;
}

/** An unresolved conflict tracked by the plugin for user resolution */
export interface UnresolvedConflict {
	path: string;
	conflictPath: string;
	localHash: string;
	serverHash: string;
	detectedAt: string;
}

/** Progress callback for sync status updates */
export type SyncProgressCallback = (
	state: SyncState,
	progress?: { current: number; total: number; message?: string },
) => void;

export interface HashingProgress {
	kind: 'hashing';
	current: number;
	total: number;
}

export interface UploadProgress {
	kind: 'uploading';
	filesCompleted: number;
	filesTotal: number;
	batchIndex: number;
	totalBatches: number;
	currentBatchSize: number;
	etaSeconds: number | null;
}

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
	batch_index?: number;
}

/** Server response to plugin registration */
export interface PluginRegistrationResponse {
	api_key: string;
	api_key_id: string;
	workspace_id: string;
	sync_manifest_endpoint: string;
	max_file_size_bytes: number;
	denied_extensions: string[];
	exclude_patterns: string[];
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
	exclude_patterns: string[];
	max_file_size_bytes: number;
	denied_extensions: string[];
}

// ============================================================================
// Sync API v2 Types (Two-Way Sync, mirrors @lumen/shared/storage.ts)
// ============================================================================

/** A file changed on the server since the plugin's last sync sequence. */
export interface ServerChange {
	path: string;
	content_hash: string;
	size_bytes: number;
	seq: number;
}

/** Conflict detected between client and server versions. */
export interface ConflictInfo {
	path: string;
	server_hash: string;
	client_hash: string;
	server_seq: number;
}

/** Server response to a manifest exchange. */
export interface SyncManifestResponseV2 {
	sync_session_id: string;
	needed_files: string[];
	deleted_files: string[];
	new_cursor: string;
	upload_endpoint: string;
	current_seq: number;
	server_changes: ServerChange[];
	server_deletions: string[];
	conflicts: ConflictInfo[];
	download_endpoint: string;
	requires_full_sync?: boolean;
	rejected_files?: Array<{ path: string; reason: string }>;
}

/** Response from the download endpoint with base64-encoded file contents. */
export interface SyncDownloadResponse {
	files: Array<{
		path: string;
		content_base64: string;
		content_hash: string;
		size_bytes: number;
	}>;
}

// ============================================================================
// Chat Types
// ============================================================================

/** A single message in the chat conversation */
export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
	sources?: Array<string | ChatSource>;
	tokenUsage?: { input: number; output: number };
}

/** A source with path and relevance score */
export interface ChatSource {
	path: string;
	score: number;
}

/** Server response to a chat request (legacy /api/chat) */
export interface ChatResponse {
	content: string;
	sources: string[];
	conversation_id?: string;
}

// ============================================================================
// Plan / Subscription Types
// ============================================================================

/** Workspace subscription tier */
export type PlanTier = 'starter' | 'plus' | 'pro' | null;

/** Cached workspace plan info */
export interface WorkspacePlanInfo {
	plan: PlanTier;
	subscriptionStatus: string | null;
	cachedAt: number;
}

// ============================================================================
// Conversation API Types
// ============================================================================

/** Summary of a conversation for listing */
export interface ConversationSummary {
	id: string;
	title: string | null;
	createdAt: string;
	updatedAt: string;
	totalInputTokens?: number;
	totalOutputTokens?: number;
	archivedAt?: string | null;
}

/** Response from GET /api/conversations */
export interface ConversationListResponse {
	conversations: ConversationSummary[];
	total: number;
}

/** Request body for POST /api/conversations/:id/messages */
export interface SendMessageRequest {
	message: string;
	deep_research?: boolean;
}

// ============================================================================
// SSE Streaming Types (Conversations API)
// ============================================================================

/** Metadata from lumen_metadata SSE event */
export interface StreamMetadata {
	sources: ChatSource[];
	tokenUsage?: { input: number; output: number };
	toolsUsed?: Array<{ name: string }>;
	turnsUsed: number;
	turnsRemaining: number;
}

/** Result of a buffered SSE chat stream */
export interface ChatStreamResult {
	content: string;
	sources: ChatSource[];
	metadata: StreamMetadata | null;
}

// ============================================================================
// Chat Error Types
// ============================================================================

/** 403 wire format: feature requires higher plan */
export interface PlanUpgradeError {
	error: 'plan_upgrade_required';
	message: string;
	required_plan: string;
}

/** 429 wire format: rate limit exceeded */
export interface RateLimitError {
	error: 'rate_limit_exceeded';
	message: string;
	limit: number;
	remaining: number;
	resets_at: string;
}

/** Thrown when server returns 403 with plan_upgrade_required */
export class PlanUpgradeRequiredError extends Error {
	readonly requiredPlan: string;

	constructor(message: string, requiredPlan: string) {
		super(message);
		this.name = 'PlanUpgradeRequiredError';
		this.requiredPlan = requiredPlan;
	}
}

/** Thrown when server returns 429 with rate limit info */
export class RateLimitExceededError extends Error {
	readonly limit: number;
	readonly remaining: number;
	readonly resetsAt: string;

	constructor(message: string, limit: number, remaining: number, resetsAt: string) {
		super(message);
		this.name = 'RateLimitExceededError';
		this.limit = limit;
		this.remaining = remaining;
		this.resetsAt = resetsAt;
	}
}

// ============================================================================
// Tool Use / Thinking Types (for streaming progress)
// ============================================================================

/** Active tool use tracked during streaming */
export interface ActiveToolUse {
	id: string;
	name: string;
	status: 'running' | 'complete';
}

/** Thinking state during streaming */
export interface ThinkingState {
	active: boolean;
	type: 'planning' | 'analyzing' | 'searching' | null;
}

// ============================================================================
// Conversation Detail Types (for loading message history)
// ============================================================================

/** A single message from the server conversation history */
export interface ConversationMessage {
	id: string;
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string | null;
	eventType?: string;
	eventData?: Record<string, unknown>;
	sources?: ChatSource[];
	createdAt: string;
}

/** Full conversation with messages (from GET /api/conversations/:id) */
export interface ConversationWithMessages {
	id: string;
	title: string | null;
	messages: ConversationMessage[];
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
	frontmatter: Record<string, unknown>;
	outgoingLinks: string[];
	incomingLinks: string[];
	relatedDocuments?: SearchResult[];
	sections: Array<{
		heading: string;
		level: number;
		content?: string;
	}>;
}
