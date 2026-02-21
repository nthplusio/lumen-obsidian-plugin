/**
 * FileHasher unit tests.
 *
 * Tests SHA-256 hashing, mtime-based caching, chunked processing,
 * exclude pattern filtering, and error handling for the FileHasher class.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileHasher } from '../../src/sync/file-hasher';
import type { LumenSettings, FileManifestEntry } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockVault() {
	return {
		read: vi.fn().mockResolvedValue('# Hello World\n\nContent here.'),
		readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
		getMarkdownFiles: vi.fn().mockReturnValue([]),
		getFiles: vi.fn().mockReturnValue([]),
		getAbstractFileByPath: vi.fn(),
		adapter: { read: vi.fn(), write: vi.fn(), exists: vi.fn() },
		on: vi.fn(),
		off: vi.fn(),
		create: vi.fn(),
	};
}

function createMockFile(path: string, mtime = 1000, size = 100) {
	return {
		path,
		name: path.split('/').pop()!,
		basename: path.split('/').pop()!.replace('.md', ''),
		extension: 'md',
		stat: { mtime, ctime: mtime, size },
		vault: {} as any,
		parent: null,
	};
}

function createSettings(overrides: Partial<LumenSettings> = {}): LumenSettings {
	return { ...DEFAULT_SETTINGS, ...overrides };
}

/**
 * Compute the expected SHA-256 hex hash for a given string
 * using Node's crypto (available in vitest's node environment).
 */
async function expectedHash(content: string): Promise<string> {
	const { createHash } = await import('node:crypto');
	return createHash('sha256').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileHasher', () => {
	let vault: ReturnType<typeof createMockVault>;
	let settings: LumenSettings;
	let hasher: FileHasher;

	beforeEach(() => {
		vi.clearAllMocks();
		vault = createMockVault();
		settings = createSettings();
		hasher = new FileHasher(vault as any, settings);
	});

	// -----------------------------------------------------------------------
	// hashFile — core hashing
	// -----------------------------------------------------------------------

	describe('hashFile', () => {
		it('returns correct SHA-256 hex string', async () => {
			const content = '# Hello World\n\nContent here.';
			vault.read.mockResolvedValue(content);

			const file = createMockFile('notes/test.md');
			const hash = await hasher.hashFile(file as any);

			const expected = await expectedHash(content);
			expect(hash).toBe(expected);
			expect(hash).toHaveLength(64);
			expect(hash).toMatch(/^[0-9a-f]{64}$/);
		});

		it('returns different hashes for different content', async () => {
			const file = createMockFile('notes/test.md');

			vault.read.mockResolvedValueOnce('Content A');
			const hashA = await hasher.hashFile(file as any);

			// Invalidate cache so it re-reads
			hasher.invalidateCache('notes/test.md');

			vault.read.mockResolvedValueOnce('Content B');
			const hashB = await hasher.hashFile(file as any);

			expect(hashA).not.toBe(hashB);
		});

		it('handles empty file content', async () => {
			vault.read.mockResolvedValue('');
			const file = createMockFile('notes/empty.md');

			const hash = await hasher.hashFile(file as any);
			const expected = await expectedHash('');

			expect(hash).toBe(expected);
			expect(hash).toHaveLength(64);
		});

		it('handles unicode content correctly', async () => {
			const content = '# 日本語テスト\n\n🎉 Emoji and 中文';
			vault.read.mockResolvedValue(content);

			const file = createMockFile('notes/unicode.md');
			const hash = await hasher.hashFile(file as any);
			const expected = await expectedHash(content);

			expect(hash).toBe(expected);
		});
	});

	// -----------------------------------------------------------------------
	// hashFile — caching behavior
	// -----------------------------------------------------------------------

	describe('hashFile caching', () => {
		it('uses cache on mtime match (does not re-read file)', async () => {
			const file = createMockFile('notes/cached.md', 5000);
			vault.read.mockResolvedValue('cached content');

			// First call — should read the file
			const hash1 = await hasher.hashFile(file as any);
			expect(vault.read).toHaveBeenCalledTimes(1);

			// Second call with same mtime — should use cache
			const hash2 = await hasher.hashFile(file as any);
			expect(vault.read).toHaveBeenCalledTimes(1); // NOT called again
			expect(hash2).toBe(hash1);
		});

		it('invalidates cache on mtime change', async () => {
			vault.read.mockResolvedValue('original content');
			const file = createMockFile('notes/changing.md', 1000);

			const hash1 = await hasher.hashFile(file as any);
			expect(vault.read).toHaveBeenCalledTimes(1);

			// Simulate file modification (different mtime)
			const updatedFile = createMockFile('notes/changing.md', 2000);
			vault.read.mockResolvedValue('updated content');

			const hash2 = await hasher.hashFile(updatedFile as any);
			expect(vault.read).toHaveBeenCalledTimes(2); // Re-read on mtime change
			expect(hash2).not.toBe(hash1);
		});

		it('invalidateCache removes specific entry', async () => {
			vault.read.mockResolvedValue('content');
			const file = createMockFile('notes/a.md', 1000);

			await hasher.hashFile(file as any);
			expect(hasher.cacheSize).toBe(1);

			hasher.invalidateCache('notes/a.md');
			expect(hasher.cacheSize).toBe(0);

			// Next hashFile call should re-read
			await hasher.hashFile(file as any);
			expect(vault.read).toHaveBeenCalledTimes(2);
		});

	});

	// -----------------------------------------------------------------------
	// hashAllFiles — batch processing
	// -----------------------------------------------------------------------

	describe('hashAllFiles', () => {
		it('processes all markdown files', async () => {
			const files = [
				createMockFile('notes/a.md', 1000, 50),
				createMockFile('notes/b.md', 2000, 75),
				createMockFile('daily/today.md', 3000, 100),
			];
			vault.getFiles.mockReturnValue(files);
			vault.read.mockResolvedValue('content');

			const result = await hasher.hashAllFiles();

			expect(result.size).toBe(3);
			expect(result.has('notes/a.md')).toBe(true);
			expect(result.has('notes/b.md')).toBe(true);
			expect(result.has('daily/today.md')).toBe(true);

			// Each entry should be a valid FileManifestEntry
			const entry = result.get('notes/a.md')!;
			expect(entry.path).toBe('notes/a.md');
			expect(entry.content_hash).toHaveLength(64);
			expect(entry.size_bytes).toBe(50);
			expect(entry.action).toBe('add'); // default action
			expect(entry.modified_at).toBe(new Date(1000).toISOString());
		});

		it('handles empty vault (no files)', async () => {
			vault.getFiles.mockReturnValue([]);

			const result = await hasher.hashAllFiles();

			expect(result.size).toBe(0);
			expect(vault.read).not.toHaveBeenCalled();
		});

		it('respects exclude patterns', async () => {
			settings = createSettings({
				excludePatterns: ['.obsidian/', '.trash/', 'templates/'],
			});
			hasher = new FileHasher(vault as any, settings);

			const files = [
				createMockFile('notes/keep.md'),
				createMockFile('.obsidian/workspace.md'),
				createMockFile('.trash/deleted.md'),
				createMockFile('templates/daily.md'),
				createMockFile('notes/also-keep.md'),
			];
			vault.getFiles.mockReturnValue(files);
			vault.read.mockResolvedValue('content');

			const result = await hasher.hashAllFiles();

			expect(result.size).toBe(2);
			expect(result.has('notes/keep.md')).toBe(true);
			expect(result.has('notes/also-keep.md')).toBe(true);
			expect(result.has('.obsidian/workspace.md')).toBe(false);
			expect(result.has('.trash/deleted.md')).toBe(false);
			expect(result.has('templates/daily.md')).toBe(false);
		});

		it('supports glob wildcards in exclude patterns', async () => {
			settings = createSettings({
				excludePatterns: ['*.tmp', 'drafts/??.md'],
			});
			hasher = new FileHasher(vault as any, settings);

			const files = [
				createMockFile('notes/keep.md'),
				createMockFile('notes/temp.tmp'),  // matches *.tmp — but won't be in getMarkdownFiles
				createMockFile('drafts/AB.md'),     // matches drafts/??.md
				createMockFile('drafts/ABC.md'),    // doesn't match (3 chars, not 2)
			];
			vault.getFiles.mockReturnValue(files);
			vault.read.mockResolvedValue('content');

			const result = await hasher.hashAllFiles();

			expect(result.has('notes/keep.md')).toBe(true);
			expect(result.has('drafts/AB.md')).toBe(false);
			expect(result.has('drafts/ABC.md')).toBe(true);
		});

		it('reports progress via callback', async () => {
			// Create 120 files to trigger multiple chunks (50 per chunk)
			const files = Array.from({ length: 120 }, (_, i) =>
				createMockFile(`notes/file-${i}.md`, i * 1000, 50),
			);
			vault.getFiles.mockReturnValue(files);
			vault.read.mockResolvedValue('content');

			const progressCalls: Array<[number, number]> = [];
			await hasher.hashAllFiles((current, total) => {
				progressCalls.push([current, total]);
			});

			// Should have 3 chunks: 50 + 50 + 20
			expect(progressCalls.length).toBe(3);
			expect(progressCalls[0]).toEqual([50, 120]);
			expect(progressCalls[1]).toEqual([100, 120]);
			expect(progressCalls[2]).toEqual([120, 120]);
		});

		it('processes files in chunks of 50', async () => {
			const files = Array.from({ length: 75 }, (_, i) =>
				createMockFile(`notes/file-${i}.md`, i * 1000, 50),
			);
			vault.getFiles.mockReturnValue(files);
			vault.read.mockResolvedValue('content');

			const result = await hasher.hashAllFiles();

			// All 75 files should be processed
			expect(result.size).toBe(75);
			expect(vault.read).toHaveBeenCalledTimes(75);
		});

		it('handles file read errors gracefully (skips bad files)', async () => {
			const files = [
				createMockFile('notes/good.md', 1000),
				createMockFile('notes/bad.md', 2000),
				createMockFile('notes/also-good.md', 3000),
			];
			vault.getFiles.mockReturnValue(files);

			vault.read
				.mockResolvedValueOnce('good content')
				.mockRejectedValueOnce(new Error('Permission denied'))
				.mockResolvedValueOnce('also good content');

			const result = await hasher.hashAllFiles();

			// Should have 2 successful entries, the bad file is skipped
			expect(result.size).toBe(2);
			expect(result.has('notes/good.md')).toBe(true);
			expect(result.has('notes/bad.md')).toBe(false);
			expect(result.has('notes/also-good.md')).toBe(true);
		});
	});
});
