#!/usr/bin/env node

/**
 * Deterministic help coverage checker.
 *
 * Parses src/main.ts for addCommand({ id: '...' }) calls and compares
 * against DOCUMENTED_COMMAND_IDS in src/help-content.ts.
 * Exits 1 if any registered commands are missing from help docs.
 *
 * No API key or LLM needed — runs in CI and pre-commit hooks.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 1. Extract command IDs from main.ts
// ---------------------------------------------------------------------------

const mainTs = readFileSync(resolve(root, 'src/main.ts'), 'utf-8');

// Match addCommand({ id: 'some-id' ... }) — handles both single and double quotes
const commandIdRegex = /addCommand\(\s*\{[^}]*?id:\s*['"]([^'"]+)['"]/g;
const registeredIds = new Set();
let match;
while ((match = commandIdRegex.exec(mainTs)) !== null) {
	registeredIds.add(match[1]);
}

if (registeredIds.size === 0) {
	console.error('ERROR: No command IDs found in src/main.ts. Is the regex correct?');
	// eslint-disable-next-line no-process-exit
	process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Extract documented command IDs from help-content.ts
// ---------------------------------------------------------------------------

const helpContent = readFileSync(resolve(root, 'src/help-content.ts'), 'utf-8');

// Match the DOCUMENTED_COMMAND_IDS array — skip the type annotation (string[])
// and capture the content between `= [` and the closing `]`
const documentedIdRegex = /DOCUMENTED_COMMAND_IDS[^=]*=\s*\[([\s\S]*?)\]/;
const arrayMatch = helpContent.match(documentedIdRegex);

if (!arrayMatch) {
	console.error('ERROR: Could not find DOCUMENTED_COMMAND_IDS array in src/help-content.ts');
	// eslint-disable-next-line no-process-exit
	process.exit(1);
}

const documentedIds = new Set();
const entryRegex = /['"]([^'"]+)['"]/g;
let entryMatch;
while ((entryMatch = entryRegex.exec(arrayMatch[1])) !== null) {
	documentedIds.add(entryMatch[1]);
}

// ---------------------------------------------------------------------------
// 3. Compare
// ---------------------------------------------------------------------------

const undocumented = [...registeredIds].filter((id) => !documentedIds.has(id));
const stale = [...documentedIds].filter((id) => !registeredIds.has(id));

let hasErrors = false;

if (undocumented.length > 0) {
	console.error(`\nERROR: ${undocumented.length} command(s) registered in main.ts but missing from help docs:`);
	for (const id of undocumented) {
		console.error(`  - ${id}`);
	}
	console.error('\nAdd these to DOCUMENTED_COMMAND_IDS in src/help-content.ts');
	hasErrors = true;
}

if (stale.length > 0) {
	console.error(`\nWARNING: ${stale.length} command(s) documented but not found in main.ts:`);
	for (const id of stale) {
		console.error(`  - ${id}`);
	}
	console.error('\nRemove these from DOCUMENTED_COMMAND_IDS in src/help-content.ts');
	hasErrors = true;
}

if (hasErrors) {
	// eslint-disable-next-line no-process-exit
	process.exit(1);
}

console.log(`OK: All ${registeredIds.size} commands are documented.`);
