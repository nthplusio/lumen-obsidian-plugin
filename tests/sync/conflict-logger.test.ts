/**
 * ConflictLogger unit tests.
 *
 * Tests conflict logging to .lumen-conflicts.md in the vault root:
 *   - File creation when log doesn't exist
 *   - Appending to existing log
 *   - Markdown format matching spec
 *   - SECURITY: No file content in logs (only path, hash, timestamp, resolution)
 *   - Error handling (vault write failures)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictLogger } from '../../src/sync/conflict-logger';
import type { ConflictEntry } from '../../src/types';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

function createMockVault() {
	return {
		read: vi.fn(),
		getAbstractFileByPath: vi.fn(),
		getMarkdownFiles: vi.fn().mockReturnValue([]),
		create: vi.fn().mockResolvedValue(undefined),
		adapter: {
			read: vi.fn().mockResolvedValue(''),
			write: vi.fn().mockResolvedValue(undefined),
			append: vi.fn().mockResolvedValue(undefined),
			exists: vi.fn().mockResolvedValue(false),
		},
		on: vi.fn(),
		off: vi.fn(),
	};
}

function createConflicts(count = 1): ConflictEntry[] {
	return Array.from({ length: count }, (_, i) => ({
		path: `notes/file-${i + 1}.md`,
		type: 'server-modified' as const,
		localHash: 'a'.repeat(64),
		serverHash: 'b'.repeat(64),
		resolution: 'server-kept' as const,
	}));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConflictLogger', () => {
	let vault: ReturnType<typeof createMockVault>;
	let logger: ConflictLogger;

	beforeEach(() => {
		vi.clearAllMocks();
		vault = createMockVault();
		logger = new ConflictLogger(vault as any);
	});

	// -----------------------------------------------------------------------
	// logConflicts — file creation/appending
	// -----------------------------------------------------------------------

	describe('logConflicts', () => {
		it('creates .lumen-conflicts.md with header if not exists', async () => {
			// File does not exist
			vault.getAbstractFileByPath.mockReturnValue(null);

			await logger.logConflicts('session-abc', createConflicts(1));

			// Should call vault.create (not adapter.append)
			expect(vault.create).toHaveBeenCalledOnce();
			const [path, content] = vault.create.mock.calls[0]!;

			expect(path).toBe('.lumen-conflicts.md');
			expect(content).toContain('# Lumen Sync Conflict Log');
			expect(content).toContain('.conflict.md');
			expect(content).toContain('notes/file-1.md');
		});

		it('appends to existing conflict log', async () => {
			// File exists
			vault.getAbstractFileByPath.mockReturnValue({ path: '.lumen-conflicts.md' });

			await logger.logConflicts('session-xyz', createConflicts(1));

			// Should call adapter.append (not vault.create)
			expect(vault.adapter.append).toHaveBeenCalledOnce();
			expect(vault.create).not.toHaveBeenCalled();

			const [path, content] = vault.adapter.append.mock.calls[0]!;
			expect(path).toBe('.lumen-conflicts.md');
			expect(content).toContain('notes/file-1.md');
		});

		it('skips silently when conflicts array is empty', async () => {
			await logger.logConflicts('session-empty', []);

			expect(vault.create).not.toHaveBeenCalled();
			expect(vault.adapter.append).not.toHaveBeenCalled();
		});

		it('handles multiple conflicts in a single log entry', async () => {
			vault.getAbstractFileByPath.mockReturnValue(null);

			const conflicts = [
				{
					path: 'notes/alpha.md',
					type: 'server-modified' as const,
					localHash: 'a'.repeat(64),
					serverHash: 'b'.repeat(64),
					resolution: 'server-kept' as const,
				},
				{
					path: 'notes/beta.md',
					type: 'local-modified' as const,
					localHash: 'c'.repeat(64),
					serverHash: 'd'.repeat(64),
					resolution: 'local-kept' as const,
				},
				{
					path: 'folder/gamma.md',
					type: 'both-modified' as const,
					localHash: 'e'.repeat(64),
					serverHash: 'f'.repeat(64),
					resolution: 'server-kept' as const,
				},
			];

			await logger.logConflicts('session-multi', conflicts);

			const content = vault.create.mock.calls[0]![1] as string;
			expect(content).toContain('**3 conflicts detected:**');
			expect(content).toContain('1. `notes/alpha.md`');
			expect(content).toContain('2. `notes/beta.md`');
			expect(content).toContain('3. `folder/gamma.md`');
		});
	});

	// -----------------------------------------------------------------------
	// Log format — spec compliance
	// -----------------------------------------------------------------------

	describe('log format', () => {
		it('includes session ID in heading', async () => {
			vault.getAbstractFileByPath.mockReturnValue(null);
			await logger.logConflicts('session-12345', createConflicts(1));

			const content = vault.create.mock.calls[0]![1] as string;
			expect(content).toContain('Sync Session: session-12345');
		});

		it('includes timestamp in heading', async () => {
			vault.getAbstractFileByPath.mockReturnValue(null);
			await logger.logConflicts('session-ts', createConflicts(1));

			const content = vault.create.mock.calls[0]![1] as string;
			// Should match pattern: ## YYYY-MM-DD HH:MM:SS
			expect(content).toMatch(/## \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
		});

		it('includes conflict type', async () => {
			vault.getAbstractFileByPath.mockReturnValue(null);

			const conflicts = [{
				path: 'test.md',
				type: 'server-modified' as const,
				localHash: 'a'.repeat(64),
				serverHash: 'b'.repeat(64),
				resolution: 'server-kept' as const,
			}];

			await logger.logConflicts('s1', conflicts);

			const content = vault.create.mock.calls[0]![1] as string;
			expect(content).toContain('Type: server-modified');
		});

		it('includes local and server hashes', async () => {
			vault.getAbstractFileByPath.mockReturnValue(null);

			const conflicts = [{
				path: 'test.md',
				type: 'both-modified' as const,
				localHash: 'a'.repeat(64),
				serverHash: 'b'.repeat(64),
				resolution: 'server-kept' as const,
			}];

			await logger.logConflicts('s2', conflicts);

			const content = vault.create.mock.calls[0]![1] as string;
			expect(content).toContain(`Local hash: \`${'a'.repeat(64)}\``);
			expect(content).toContain(`Server hash: \`${'b'.repeat(64)}\``);
		});

		it('includes resolution action', async () => {
			vault.getAbstractFileByPath.mockReturnValue(null);

			const serverKept = [{
				path: 'a.md',
				type: 'server-modified' as const,
				localHash: 'a'.repeat(64),
				serverHash: 'b'.repeat(64),
				resolution: 'server-kept' as const,
			}];

			await logger.logConflicts('s3', serverKept);

			const content = vault.create.mock.calls[0]![1] as string;
			expect(content).toContain('Resolution: Server version kept');
		});

		it('uses numbered list for multiple conflicts', async () => {
			vault.getAbstractFileByPath.mockReturnValue(null);
			await logger.logConflicts('s4', createConflicts(3));

			const content = vault.create.mock.calls[0]![1] as string;
			expect(content).toContain('1. `notes/file-1.md`');
			expect(content).toContain('2. `notes/file-2.md`');
			expect(content).toContain('3. `notes/file-3.md`');
		});

		it('singularizes "conflict" for count of 1', async () => {
			vault.getAbstractFileByPath.mockReturnValue(null);
			await logger.logConflicts('s5', createConflicts(1));

			const content = vault.create.mock.calls[0]![1] as string;
			expect(content).toContain('**1 conflict detected:**');
		});

		it('pluralizes "conflicts" for count > 1', async () => {
			vault.getAbstractFileByPath.mockReturnValue(null);
			await logger.logConflicts('s6', createConflicts(2));

			const content = vault.create.mock.calls[0]![1] as string;
			expect(content).toContain('**2 conflicts detected:**');
		});

		it('ends entry with horizontal rule separator', async () => {
			vault.getAbstractFileByPath.mockReturnValue(null);
			await logger.logConflicts('s7', createConflicts(1));

			const content = vault.create.mock.calls[0]![1] as string;
			expect(content).toContain('\n---\n');
		});
	});

	// -----------------------------------------------------------------------
	// SECURITY: No file content in logs (M8)
	// -----------------------------------------------------------------------

	describe('security', () => {
		it('never logs file content — only path, hash, timestamp, resolution', async () => {
			vault.getAbstractFileByPath.mockReturnValue(null);

			const conflicts = [{
				path: 'secret/passwords.md',
				type: 'server-modified' as const,
				localHash: 'a'.repeat(64),
				serverHash: 'b'.repeat(64),
				resolution: 'server-kept' as const,
			}];

			await logger.logConflicts('sec-test', conflicts);

			const content = vault.create.mock.calls[0]![1] as string;

			// Content should contain ONLY structural elements, no file content
			expect(content).toContain('secret/passwords.md'); // path is OK
			expect(content).toContain('a'.repeat(64));         // hash is OK
			expect(content).toContain('b'.repeat(64));         // hash is OK

			// Should NOT contain any arbitrary content
			// (The ConflictEntry type doesn't even have a content field, but
			//  we verify the output only contains expected structural elements)
			const lines = content.split('\n');
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed === '') continue;

				// Each line should be a heading, bullet, separator, or known metadata
				const isStructural =
					trimmed.startsWith('#') ||       // heading
					trimmed.startsWith('**') ||      // bold count
					trimmed.startsWith('-') ||        // bullet detail
					trimmed.startsWith('---') ||      // separator
					/^\d+\.\s`/.test(trimmed) ||      // numbered list item
					trimmed.includes('Lumen') ||      // header text
					trimmed.includes('conflict') ||   // header text
					trimmed.includes('.conflict.md'); // header text

				expect(isStructural).toBe(true);
			}
		});
	});

	// -----------------------------------------------------------------------
	// Error handling
	// -----------------------------------------------------------------------

	describe('error handling', () => {
		it('handles vault write errors gracefully (does not throw)', async () => {
			vault.getAbstractFileByPath.mockReturnValue(null);
			vault.create.mockRejectedValue(new Error('Disk full'));

			// Should not throw — error is caught internally
			await expect(
				logger.logConflicts('s-err', createConflicts(1)),
			).resolves.toBeUndefined();
		});

		it('handles vault append errors gracefully', async () => {
			vault.getAbstractFileByPath.mockReturnValue({ path: '.lumen-conflicts.md' });
			vault.adapter.append.mockRejectedValue(new Error('Permission denied'));

			await expect(
				logger.logConflicts('s-err2', createConflicts(1)),
			).resolves.toBeUndefined();
		});
	});
});
