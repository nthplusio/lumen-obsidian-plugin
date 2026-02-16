/**
 * Exclude-pattern matching for vault file paths.
 *
 * Pattern rules:
 * - Trailing `/` → directory prefix match (e.g. `.obsidian/` matches `.obsidian/workspace.json`)
 * - `*` → any sequence of characters
 * - `?` → any single character
 * - All patterns are anchored at the start of the path.
 */

/**
 * Check if a file path matches any of the given exclude patterns.
 */
export function isExcludedByPatterns(path: string, patterns: string[]): boolean {
	return patterns.some((pattern) => {
		const regexStr = pattern
			.replace(/[.+^${}()|[\]\\]/g, '\\$&')
			.replace(/\*/g, '.*')
			.replace(/\?/g, '.');
		return new RegExp(`^${regexStr}`).test(path);
	});
}
