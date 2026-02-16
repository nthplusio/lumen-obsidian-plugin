/**
 * FileHasher — SHA-256 hashing with caching and chunked processing.
 *
 * Computes SHA-256 hashes for .md files in the vault using the Web Crypto
 * API. Maintains an in-memory cache keyed by (path, mtime) to skip
 * unchanged files. Processes files in chunks of 50 with 10ms yielding
 * breaks to keep Obsidian's UI responsive during large vault hashing.
 */

import { Notice, Platform, TFile, Vault } from 'obsidian';
import type { FileManifestEntry, LumenSettings } from '../types';
import { logger } from '../utils/logger';
import { isExcludedByPatterns } from '../utils/exclude-pattern';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CachedHash {
	hash: string;
	mtime: number; // file.stat.mtime at time of hashing
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Files processed per chunk before yielding to the UI thread. */
const CHUNK_SIZE = 50;

/** Milliseconds to wait between chunks (prevents UI freezing). */
const CHUNK_DELAY_MS = 10;

/** File count threshold for mobile large-vault warning. */
const MOBILE_LARGE_VAULT_THRESHOLD = 5000;

// ---------------------------------------------------------------------------
// FileHasher
// ---------------------------------------------------------------------------

export class FileHasher {
	private vault: Vault;
	private settings: LumenSettings;
	private hashCache: Map<string, CachedHash> = new Map();

	constructor(vault: Vault, settings: LumenSettings) {
		this.vault = vault;
		this.settings = settings;
	}

	/**
	 * Hash all eligible .md files in the vault.
	 *
	 * Skips files matching exclude patterns from settings.
	 * Uses the mtime cache to avoid rehashing unchanged files.
	 * Processes in chunks of {@link CHUNK_SIZE} with {@link CHUNK_DELAY_MS}
	 * breaks between chunks.
	 *
	 * @param onProgress — Called after each chunk with (current, total).
	 * @returns Map of vault-relative path to FileManifestEntry.
	 *          The `action` field defaults to `'add'`; the caller
	 *          (SyncManager) is responsible for determining the real action.
	 */
	async hashAllFiles(
		onProgress?: (current: number, total: number) => void,
	): Promise<Map<string, FileManifestEntry>> {
		const files = this.vault
			.getMarkdownFiles()
			.filter((f) => !this.isExcluded(f.path));

		// Warn on mobile for large vaults — hashing is CPU-intensive
		if (Platform.isMobile && files.length > MOBILE_LARGE_VAULT_THRESHOLD) {
			new Notice(
				`Large vault (${files.length} files) — sync may be slow on mobile. ` +
				'Consider adding exclude patterns in Settings.',
				8000,
			);
			logger.warn(`Large vault on mobile: ${files.length} files exceeds ${MOBILE_LARGE_VAULT_THRESHOLD} threshold`);
		}

		const result = new Map<string, FileManifestEntry>();

		logger.debug(`Hashing ${files.length} markdown files (chunk: ${CHUNK_SIZE})`);

		for (let i = 0; i < files.length; i += CHUNK_SIZE) {
			const chunk = files.slice(i, i + CHUNK_SIZE);

			for (const file of chunk) {
				try {
					const hash = await this.hashFile(file);
					result.set(file.path, {
						path: file.path,
						content_hash: hash,
						modified_at: new Date(file.stat.mtime).toISOString(),
						size_bytes: file.stat.size,
						action: 'add', // default — SyncManager determines actual action
					});
				} catch (error) {
					// Skip individual failures so one bad file doesn't block the sync
					logger.error(`Failed to hash ${file.path}:`, error);
				}
			}

			const current = Math.min(i + chunk.length, files.length);
			onProgress?.(current, files.length);

			// Yield to UI thread between chunks (skip after the last chunk)
			if (i + CHUNK_SIZE < files.length) {
				await this.yieldToUI();
			}
		}

		logger.debug(`Hashed ${result.size}/${files.length} files`);
		return result;
	}

	/**
	 * Hash a single file, using the cache when possible.
	 *
	 * Cache hit: file.stat.mtime matches cached mtime → return cached hash.
	 * Cache miss: read file, compute SHA-256, update cache.
	 */
	async hashFile(file: TFile): Promise<string> {
		const cached = this.hashCache.get(file.path);

		if (cached && cached.mtime === file.stat.mtime) {
			return cached.hash;
		}

		const content = await this.vault.read(file);
		const hash = await this.computeSHA256(content);

		this.hashCache.set(file.path, { hash, mtime: file.stat.mtime });
		return hash;
	}

	/**
	 * Remove a path from the cache.
	 * Call when a file is modified, renamed, or deleted.
	 */
	invalidateCache(path: string): void {
		this.hashCache.delete(path);
	}

	/** Clear the entire hash cache. */
	clearCache(): void {
		this.hashCache.clear();
		logger.debug('Hash cache cleared');
	}

	/**
	 * Return the cached hash for a path, or null if not cached / stale.
	 * Does NOT recompute — purely reads the cache.
	 */
	getCachedHash(path: string): string | null {
		return this.hashCache.get(path)?.hash ?? null;
	}

	/** Number of entries currently in the cache. */
	get cacheSize(): number {
		return this.hashCache.size;
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	private isExcluded(path: string): boolean {
		return isExcludedByPatterns(path, this.settings.excludePatterns);
	}

	/** Compute SHA-256 hash of a string using Web Crypto API. */
	private async computeSHA256(content: string): Promise<string> {
		const data = new TextEncoder().encode(content);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = new Uint8Array(hashBuffer);
		return Array.from(hashArray, (b) => b.toString(16).padStart(2, '0')).join('');
	}

	/** Yield to the UI thread via setTimeout. */
	private yieldToUI(): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
	}
}
