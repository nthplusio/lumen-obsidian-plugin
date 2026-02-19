/**
 * Path safety and Markdown sanitization utilities for sync operations.
 *
 * Guards against path traversal from server-controlled paths and
 * Markdown injection in conflict log entries.
 */

/**
 * Validate that a file path is safe for vault write/delete operations.
 *
 * Rejects paths that could escape the vault root:
 * - Parent traversal (`..`)
 * - Absolute paths (leading `/`)
 * - Null bytes (`\0`)
 * - Backslashes (Windows traversal)
 * - Current-directory segments (`.`)
 */
export function isSafePath(path: string): boolean {
	if (!path || path.length === 0) return false;
	if (path.includes('\0')) return false;
	if (path.startsWith('/')) return false;
	if (path.includes('\\')) return false;
	const segments = path.split('/');
	return segments.every(s => s !== '..' && s !== '.' && s.length > 0);
}

/**
 * Escape Markdown-sensitive characters in a string for safe embedding
 * in Markdown output. Prevents injection of links, images, or formatting.
 */
export function escapeMd(s: string): string {
	return s.replace(/[`\[\]|\\<>*_~#]/g, '\\$&');
}

const VALID_CONFLICT_TYPES = new Set(['server-modified', 'local-modified', 'both-modified']);
const VALID_RESOLUTIONS = new Set(['server-kept', 'local-kept']);

/** Return the conflict type if valid, otherwise 'unknown'. */
export function sanitizeConflictType(type: string): string {
	return VALID_CONFLICT_TYPES.has(type) ? type : 'unknown';
}

/** Return the resolution if valid, otherwise 'unknown'. */
export function sanitizeResolution(resolution: string): string {
	return VALID_RESOLUTIONS.has(resolution) ? resolution : 'unknown';
}
