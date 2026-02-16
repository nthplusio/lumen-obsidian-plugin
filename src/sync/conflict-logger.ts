/**
 * ConflictLogger — Logs sync conflicts to .lumen-conflicts.md in the vault root.
 *
 * When the server overwrites local changes (last-write-wins), this logger
 * records the conflict for user review. Append-only so the history is preserved.
 *
 * SECURITY (M8): NEVER log file content or diffs — only paths, hashes,
 * timestamps, and resolution actions.
 */

import type { Vault } from 'obsidian';
import type { ConflictEntry } from '../types';
import { logger } from '../utils/logger';

const CONFLICT_LOG_PATH = '.lumen-conflicts.md';

const LOG_HEADER = `# Lumen Sync Conflict Log

This file logs conflicts detected during vault sync.
Conflicts are resolved using last-write-wins (server version kept).

---

`;

export class ConflictLogger {
	private vault: Vault;

	constructor(vault: Vault) {
		this.vault = vault;
	}

	/**
	 * Append conflict entries to the log file.
	 *
	 * Creates the file with a header if it doesn't exist yet.
	 */
	async logConflicts(sessionId: string, conflicts: ConflictEntry[]): Promise<void> {
		if (conflicts.length === 0) return;

		const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
		const entry = this.formatEntry(timestamp, sessionId, conflicts);

		try {
			const exists = this.vault.getAbstractFileByPath(CONFLICT_LOG_PATH);

			if (exists) {
				await this.vault.adapter.append(CONFLICT_LOG_PATH, entry);
			} else {
				await this.vault.create(CONFLICT_LOG_PATH, LOG_HEADER + entry);
			}

			logger.info(`Logged ${conflicts.length} conflict(s) for session ${sessionId}`);
		} catch (err) {
			// Don't let logging failures break the sync flow
			logger.error('Failed to write conflict log:', err);
		}
	}

	/**
	 * Read the full conflict log, or null if it doesn't exist.
	 */
	async getConflictLog(): Promise<string | null> {
		try {
			const file = this.vault.getAbstractFileByPath(CONFLICT_LOG_PATH);
			if (!file) return null;
			return await this.vault.adapter.read(CONFLICT_LOG_PATH);
		} catch {
			return null;
		}
	}

	/**
	 * Format a set of conflicts into a markdown section.
	 *
	 * Output follows the spec format:
	 * ## <timestamp> (Sync Session: <id>)
	 * **N conflicts detected:**
	 * 1. `<path>` ...
	 */
	private formatEntry(timestamp: string, sessionId: string, conflicts: ConflictEntry[]): string {
		const lines: string[] = [];

		lines.push(`## ${timestamp} (Sync Session: ${sessionId})`);
		lines.push('');
		lines.push(`**${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} detected:**`);
		lines.push('');

		for (let i = 0; i < conflicts.length; i++) {
			const c = conflicts[i]!;
			lines.push(`${i + 1}. \`${c.path}\``);
			lines.push(`   - Type: ${c.type}`);
			lines.push(`   - Local hash: \`${c.localHash}\``);
			lines.push(`   - Server hash: \`${c.serverHash}\``);
			lines.push(`   - Resolution: ${c.resolution === 'server-kept' ? 'Server version kept' : 'Local version kept'}`);
			lines.push('');
		}

		lines.push('---');
		lines.push('');

		return lines.join('\n');
	}
}
