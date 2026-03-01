#!/usr/bin/env node

/**
 * Optional LLM-powered help content drafting tool.
 *
 * Reads source files and current help-content.ts, sends to Claude Haiku,
 * and outputs a suggested updated help-content.ts to stdout.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/draft-help-content.mjs
 *
 * This is a developer convenience tool — not in any hook or CI pipeline.
 * Review the output before applying.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Check for API key
// ---------------------------------------------------------------------------

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
	console.error('No ANTHROPIC_API_KEY environment variable set.');
	console.error('');
	console.error('Usage:');
	console.error('  ANTHROPIC_API_KEY=sk-... node scripts/draft-help-content.mjs');
	console.error('');
	console.error('This script requires the @anthropic-ai/sdk package:');
	console.error('  npm install --save-dev @anthropic-ai/sdk');
	process.exit(1);
}

// ---------------------------------------------------------------------------
// Dynamic import of SDK (devDependency — may not be installed)
// ---------------------------------------------------------------------------

let Anthropic;
try {
	const sdk = await import('@anthropic-ai/sdk');
	Anthropic = sdk.default;
} catch {
	console.error('Could not import @anthropic-ai/sdk. Install it first:');
	console.error('  npm install --save-dev @anthropic-ai/sdk');
	process.exit(1);
}

// ---------------------------------------------------------------------------
// Read source files
// ---------------------------------------------------------------------------

function readSource(relativePath) {
	try {
		return readFileSync(resolve(root, relativePath), 'utf-8');
	} catch {
		return `[File not found: ${relativePath}]`;
	}
}

const sourceFiles = {
	'src/main.ts': readSource('src/main.ts'),
	'src/help-content.ts': readSource('src/help-content.ts'),
	'src/types.ts': readSource('src/types.ts'),
	'src/dataview-api.ts': readSource('src/dataview-api.ts'),
};

// ---------------------------------------------------------------------------
// Build prompt
// ---------------------------------------------------------------------------

const fileContext = Object.entries(sourceFiles)
	.map(([path, content]) => `### ${path}\n\`\`\`typescript\n${content}\n\`\`\``)
	.join('\n\n');

const prompt = `You are updating help documentation for the Lumen Obsidian plugin.

Below are the current source files. Your task is to output an updated version of src/help-content.ts
that accurately documents all features visible in the source code.

Rules:
- Keep the same TypeScript interfaces and export structure
- DOCUMENTED_COMMAND_IDS must list every command ID from addCommand() in main.ts
- Each section should accurately describe current behavior (not aspirational features)
- Use the same ContentBlock types — don't invent new ones
- Output ONLY the TypeScript file content, no explanations

${fileContext}

Output the complete updated src/help-content.ts:`;

// ---------------------------------------------------------------------------
// Call Claude
// ---------------------------------------------------------------------------

const client = new Anthropic();

console.error('Sending to Claude Haiku 4.5...');

const response = await client.messages.create({
	model: 'claude-haiku-4-5-20251001',
	max_tokens: 8192,
	messages: [{ role: 'user', content: prompt }],
});

const text = response.content
	.filter((block) => block.type === 'text')
	.map((block) => block.text)
	.join('');

// Strip markdown code fences if present
const cleaned = text.replace(/^```typescript\n?/, '').replace(/\n?```$/, '');

console.log(cleaned);
console.error('\nDone. Review the output above and apply manually if it looks correct.');
