/**
 * Shared constants for the sync subsystem.
 */

/**
 * File extensions treated as text (read as string, hashed via TextEncoder).
 * All other extensions are treated as binary (read as ArrayBuffer, hashed as raw bytes).
 */
export const TEXT_EXTENSIONS = new Set([
	'md', 'txt', 'csv', 'json', 'yaml', 'yml', 'xml', 'html', 'css',
	'js', 'ts', 'jsx', 'tsx', 'svg', 'ini', 'cfg', 'conf', 'log',
	'sh', 'bat', 'ps1', 'py', 'rb', 'java', 'c', 'cpp', 'h', 'hpp',
	'rs', 'go', 'swift', 'kt', 'lua', 'r', 'sql', 'graphql', 'toml',
	'env', 'gitignore', 'dockerfile',
	// Additional common text formats
	'tex', 'bib', 'org', 'rst', 'mdx', 'ndjson', 'jsonl', 'properties',
	'tsv', 'cjs', 'mjs', 'vue', 'svelte', 'astro',
]);

/** Number of files per upload batch. */
export const UPLOAD_BATCH_SIZE = 25;

/** Max retries per individual batch. */
export const BATCH_MAX_RETRIES = 3;

/** Base delay for batch retry backoff (ms). */
export const BATCH_RETRY_BASE_MS = 1_000;

/** Notice duration for errors (WCAG 2.2.1 minimum). */
export const NOTICE_DURATION_ERROR_MS = 8_000;

/** Notice duration for informational messages. */
export const NOTICE_DURATION_INFO_MS = 5_000;
