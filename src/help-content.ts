/**
 * Structured help content for the Lumen plugin.
 *
 * All help documentation lives here as data — the modal renderer
 * in help-modal.ts iterates these structures to build the DOM.
 * The coverage checker (scripts/check-help-coverage.mjs) validates
 * that DOCUMENTED_COMMAND_IDS stays in sync with registered commands.
 */

// ---------------------------------------------------------------------------
// Content block types
// ---------------------------------------------------------------------------

export type ContentBlock =
	| { type: 'paragraph'; text: string }
	| { type: 'subheading'; text: string }
	| { type: 'ordered-list'; items: string[] }
	| { type: 'unordered-list'; items: string[] }
	| { type: 'tip'; text: string }
	| { type: 'warning'; text: string }
	| { type: 'score-table'; rows: Array<{ label: string; description: string; cls: string }> }
	| { type: 'settings-table'; rows: Array<{ name: string; description: string }> }
	| { type: 'shortcuts-table'; rows: Array<{ command: string; description: string }> }
	| { type: 'issues-list'; issues: Array<{ title: string; cause: string; fix: string }> }
	| { type: 'code-block'; code: string };

export interface HelpSection {
	id: string;
	title: string;
	icon: string;
	defaultOpen: boolean;
	content: ContentBlock[];
}

// ---------------------------------------------------------------------------
// All command IDs registered via addCommand() in main.ts
// ---------------------------------------------------------------------------

export const DOCUMENTED_COMMAND_IDS: string[] = [
	'search',
	'sync-now',
	'cancel-sync',
	'help',
	'debug-log',
	'quick-search',
	'focus-search',
	'open-chat',
	'new-chat',
	'toggle-mode',
	'open-related',
	'find-similar',
];

// ---------------------------------------------------------------------------
// Help sections
// ---------------------------------------------------------------------------

export const HELP_SECTIONS: HelpSection[] = [
	// 1. Getting Started
	{
		id: 'getting-started',
		title: 'Getting Started',
		icon: 'rocket',
		defaultOpen: true,
		content: [
			{
				type: 'paragraph',
				text: 'Lumen brings AI-powered semantic search and chat to your Obsidian vault. Instead of keyword matching, Lumen understands the meaning of your notes and finds relevant content even when exact words don\'t match.',
			},
			{ type: 'subheading', text: 'Initial Setup' },
			{
				type: 'ordered-list',
				items: [
					'Obtain your API key from getlumen.io.',
					'Open Settings \u2192 Lumen and enter your API key.',
					'Your Workspace ID will be resolved automatically from your API key.',
					'Vault Sync starts automatically once your key is configured — your notes will be indexed for search.',
					'Use the search sidebar, chat, or Ctrl/Cmd+P \u2192 "Lumen: Open Lumen" to start exploring.',
				],
			},
			{
				type: 'tip',
				text: 'After your first sync completes, all your Markdown notes are searchable. Non-Markdown files (images, PDFs, attachments) are not indexed.',
			},
		],
	},

	// 2. Semantic Search
	{
		id: 'semantic-search',
		title: 'Semantic Search',
		icon: 'search',
		defaultOpen: false,
		content: [
			{
				type: 'paragraph',
				text: 'Semantic search finds notes by meaning rather than exact keywords. Ask natural language questions like "notes about project planning" or "ideas I had about machine learning" and Lumen will find the most relevant content.',
			},
			{ type: 'subheading', text: 'How to Search' },
			{
				type: 'unordered-list',
				items: [
					'Open the Lumen sidebar (ribbon icon or command palette) to use the full search view.',
					'Use "Lumen: Quick search" for a fast modal search overlay — great for quick lookups without leaving your current note.',
					'Use "Lumen: Focus search input" to jump directly to the search box in the sidebar.',
					'Type your query in natural language \u2014 full sentences work best.',
					'Results appear in real-time as you type (with a short debounce delay).',
					'Click any result to open the note in your editor.',
				],
			},
			{ type: 'subheading', text: 'Understanding Scores' },
			{
				type: 'score-table',
				rows: [
					{ label: 'High (80\u2013100%)', description: 'Strong semantic match. Very relevant to your query.', cls: 'lumen-help-score-high' },
					{ label: 'Medium (50\u201379%)', description: 'Partial relevance. Related topics or tangential mentions.', cls: 'lumen-help-score-medium' },
					{ label: 'Low (below 50%)', description: 'Weak match. May contain loosely related concepts.', cls: 'lumen-help-score-low' },
				],
			},
			{ type: 'subheading', text: 'Query Tips' },
			{
				type: 'unordered-list',
				items: [
					'Be specific: "meeting with Sarah about Q3 budget" works better than "meeting".',
					'Use natural language, not Boolean operators (no AND/OR/NOT).',
					'Try rephrasing if results aren\'t what you expected \u2014 different wording can surface different notes.',
					'Queries are matched against note content, headings, and tags.',
				],
			},
		],
	},

	// 3. Chat
	{
		id: 'chat',
		title: 'Chat',
		icon: 'message-square',
		defaultOpen: false,
		content: [
			{
				type: 'paragraph',
				text: 'Chat lets you have AI-powered conversations grounded in your vault\'s content. Ask questions, get summaries, or explore topics — Lumen searches your notes for relevant context and uses it to generate responses.',
			},
			{ type: 'subheading', text: 'How to Use Chat' },
			{
				type: 'unordered-list',
				items: [
					'Open the Lumen sidebar and switch to the Chat tab, or use "Lumen: Open chat" from the command palette.',
					'Type a message and press Enter to send. Responses stream in real-time with Markdown formatting.',
					'Each conversation is saved and can be resumed later from the conversation list.',
					'Use "Lumen: New chat" to start a fresh conversation.',
					'The active note\'s content is automatically included as context when you ask a question.',
				],
			},
			{ type: 'subheading', text: 'Deep Research Mode' },
			{
				type: 'paragraph',
				text: 'For complex questions, toggle the Deep Research switch before sending your message. This performs a more thorough multi-step search across your vault, taking longer but producing more comprehensive answers.',
			},
			{ type: 'subheading', text: 'Rate Limits' },
			{
				type: 'paragraph',
				text: 'Chat usage is subject to rate limits based on your plan tier. If you hit a limit, Lumen will show when it resets. Upgrade your plan for higher limits.',
			},
		],
	},

	// 4. Related Notes
	{
		id: 'related-notes',
		title: 'Related Notes',
		icon: 'git-branch',
		defaultOpen: false,
		content: [
			{
				type: 'paragraph',
				text: 'The Related Notes tab shows notes that are semantically similar to the file you\'re currently editing. It updates automatically when you switch between files.',
			},
			{ type: 'subheading', text: 'How It Works' },
			{
				type: 'unordered-list',
				items: [
					'Open the Lumen sidebar and switch to the Related tab, or use "Lumen: Open related notes" from the command palette.',
					'Lumen finds notes with similar meaning to your active note.',
					'Results include relevance scores so you can see how closely related each note is.',
					'Click any result to open it in your editor.',
					'Use "Lumen: Toggle search / chat / related" to cycle between sidebar modes.',
				],
			},
			{
				type: 'tip',
				text: 'Related Notes is a great way to discover connections between notes you might not have linked manually.',
			},
		],
	},

	// 5. Find Similar Notes
	{
		id: 'find-similar',
		title: 'Find Similar Notes',
		icon: 'files',
		defaultOpen: false,
		content: [
			{
				type: 'paragraph',
				text: 'Find Similar Notes opens a modal showing notes semantically similar to a specific file. Unlike Related Notes (which tracks your active file), this is an on-demand action for any Markdown file.',
			},
			{ type: 'subheading', text: 'How to Use' },
			{
				type: 'unordered-list',
				items: [
					'With a Markdown file open, run "Lumen: Find similar notes" from the command palette.',
					'Or right-click any Markdown file in the file explorer and select "Find similar notes" from the context menu.',
					'Results show relevance score badges (high, medium, low) so you can gauge how closely related each note is.',
				],
			},
		],
	},

	// 6. Vault Sync
	{
		id: 'vault-sync',
		title: 'Vault Sync',
		icon: 'refresh-cw',
		defaultOpen: false,
		content: [
			{
				type: 'paragraph',
				text: 'Vault Sync sends your Markdown notes to the Lumen server for indexing. Once indexed, notes are searchable via semantic search and available as context for chat. Only .md files are synced \u2014 images, PDFs, and other attachments are not included.',
			},
			{ type: 'subheading', text: 'How Sync Works' },
			{
				type: 'ordered-list',
				items: [
					'The plugin computes a SHA-256 fingerprint of each Markdown file.',
					'It sends a manifest of file paths and hashes to the server.',
					'The server compares against its records, identifies changes in both directions, and requests only files that need updating.',
					'Changed files are uploaded (local \u2192 server) and downloaded (server \u2192 local), then the server triggers re-indexing.',
				],
			},
			{ type: 'subheading', text: 'Two-Way Sync' },
			{
				type: 'paragraph',
				text: 'Sync works in both directions. Files you edit locally are uploaded to the server, and files changed on other devices (via the server) are downloaded to your vault. This keeps all your devices in sync.',
			},
			{ type: 'subheading', text: 'Auto Sync' },
			{
				type: 'unordered-list',
				items: [
					'Sync runs automatically on a server-configured interval (typically 60 seconds) and when files change.',
					'Manual sync can be triggered with "Lumen: Sync vault with Lumen" from the command palette.',
					'Cancel a running sync with "Lumen: Cancel active sync" if needed.',
					'The status bar shows current sync state, progress, and last sync time.',
				],
			},
			{ type: 'subheading', text: 'Exclude Patterns' },
			{
				type: 'paragraph',
				text: 'Files matching exclude patterns are skipped during sync. Patterns are configured server-side (not in plugin settings). By default, .obsidian/ and .trash/ are excluded.',
			},
		],
	},

	// 7. Conflict Resolution
	{
		id: 'conflict-resolution',
		title: 'Conflict Resolution',
		icon: 'git-merge',
		defaultOpen: false,
		content: [
			{
				type: 'paragraph',
				text: 'When the same file is modified on multiple devices between syncs, Lumen detects the conflict and lets you choose how to resolve it.',
			},
			{ type: 'subheading', text: 'How Conflicts Are Handled' },
			{
				type: 'ordered-list',
				items: [
					'During sync, the server compares your local hashes with its records.',
					'If both sides changed the same file, a conflict is flagged.',
					'A conflict copy (*.conflict.md) is saved in your vault so no data is lost.',
					'A conflict banner appears in the sidebar prompting you to resolve it.',
				],
			},
			{ type: 'subheading', text: 'Resolution Options' },
			{
				type: 'unordered-list',
				items: [
					'Keep Local \u2014 use your local version, discard the server version.',
					'Keep Server \u2014 use the server version, discard your local changes.',
					'Keep Both \u2014 leave both files in your vault (the conflict copy remains).',
				],
			},
			{
				type: 'tip',
				text: 'All conflicts are also logged to .lumen-conflicts.md in your vault root for a full audit trail.',
			},
		],
	},

	// 8. Configuration
	{
		id: 'configuration',
		title: 'Configuration',
		icon: 'settings',
		defaultOpen: false,
		content: [
			{
				type: 'paragraph',
				text: 'All settings are in Settings \u2192 Lumen. Here\'s what each option does:',
			},
			{
				type: 'settings-table',
				rows: [
					{
						name: 'API Key',
						description: 'Your authentication key. Stored locally in the plugin\'s data.json file. Enter your key and the plugin will automatically connect and resolve your workspace.',
					},
					{
						name: 'Debug Mode',
						description: 'Enables verbose logging and opens the Debug Log view. Useful for troubleshooting sync or search issues.',
					},
					{
						name: 'Workspace ID',
						description: 'Read-only. Automatically resolved from your API key. Identifies which workspace your vault syncs to.',
					},
					{
						name: 'Device ID',
						description: 'Read-only. A unique identifier for this device, generated on first setup.',
					},
				],
			},
			{
				type: 'tip',
				text: 'Sync interval and exclude patterns are managed server-side — you don\'t need to configure them in the plugin.',
			},
		],
	},

	// 9. Debug Log
	{
		id: 'debug-log',
		title: 'Debug Log',
		icon: 'terminal',
		defaultOpen: false,
		content: [
			{
				type: 'paragraph',
				text: 'The Debug Log is a live viewer for plugin activity. It shows sync operations, API calls, errors, and other internal events in real time.',
			},
			{ type: 'subheading', text: 'How to Use' },
			{
				type: 'unordered-list',
				items: [
					'Open via "Lumen: Open Debug Log" from the command palette, or enable Debug Mode in settings.',
					'Filter log entries by level (debug, info, warn, error).',
					'Copy individual entries or save the entire log to a file for sharing with support.',
					'Clear the log to start fresh.',
				],
			},
			{
				type: 'tip',
				text: 'When reporting issues, include a copy of the debug log — it helps diagnose problems much faster.',
			},
		],
	},

	// 10. Dataview API
	{
		id: 'dataview-api',
		title: 'Dataview API',
		icon: 'code',
		defaultOpen: false,
		content: [
			{
				type: 'paragraph',
				text: 'Lumen exposes an experimental JavaScript API for use in Dataview JS blocks. This lets you build custom views powered by semantic search.',
			},
			{ type: 'subheading', text: 'Access' },
			{
				type: 'code-block',
				code: 'const lumen = app.plugins.plugins[\'lumen-search\'].api;',
			},
			{ type: 'subheading', text: 'Available Methods' },
			{
				type: 'unordered-list',
				items: [
					'search(query, { limit?, tags? }) — Semantic search across the vault.',
					'getSimilar(documentPath, { limit? }) — Find notes similar to a given document.',
					'getTags() — Get all tags with document counts.',
				],
			},
			{ type: 'subheading', text: 'Example' },
			{
				type: 'code-block',
				code: 'const lumen = app.plugins.plugins[\'lumen-search\'].api;\nconst results = await lumen.search("machine learning", { limit: 5 });\ndv.list(results.map(r => r.source_path));',
			},
			{
				type: 'warning',
				text: 'The Dataview API is experimental and may change in future releases. Requires the Dataview plugin to be installed.',
			},
		],
	},

	// 11. Troubleshooting
	{
		id: 'troubleshooting',
		title: 'Troubleshooting',
		icon: 'wrench',
		defaultOpen: false,
		content: [
			{
				type: 'paragraph',
				text: 'Common issues and how to resolve them:',
			},
			{
				type: 'issues-list',
				issues: [
					{
						title: 'Connection refused',
						cause: 'The Lumen server is not running or unreachable.',
						fix: 'Check your internet connection. If the issue persists, the Lumen service may be temporarily unavailable.',
					},
					{
						title: 'Authentication failed (401)',
						cause: 'Your API key is invalid, expired, or has been revoked.',
						fix: 'Generate a new API key from getlumen.io and update it in Settings \u2192 Lumen.',
					},
					{
						title: 'Access denied (403)',
						cause: 'Your API key does not have permission for this workspace.',
						fix: 'Check your workspace membership at getlumen.io, or contact support.',
					},
					{
						title: 'Plan upgrade required',
						cause: 'The feature you\'re trying to use requires a higher plan tier.',
						fix: 'Upgrade your plan at getlumen.io to unlock this feature.',
					},
					{
						title: 'Rate limit exceeded (429)',
						cause: 'You\'ve exceeded the request limit for your plan.',
						fix: 'Wait for the limit to reset (shown in the error message), or upgrade your plan for higher limits.',
					},
					{
						title: 'Sync timeout',
						cause: 'Large uploads may time out on slow connections.',
						fix: 'The plugin will retry automatically with exponential backoff (up to 3 retries). If the problem persists, check your network connection.',
					},
					{
						title: 'Server error (500/502/503)',
						cause: 'The server is experiencing issues or restarting.',
						fix: 'Wait a moment and retry. If the problem persists, check status.getlumen.io or contact support.',
					},
					{
						title: 'No search results',
						cause: 'Your vault may not be indexed yet, or the query didn\'t match any content.',
						fix: 'Ensure sync has completed at least once (check status bar). Try broader or rephrased queries.',
					},
					{
						title: 'Sync shows 0 files',
						cause: 'All files may already be up to date, or all files match exclude patterns.',
						fix: 'This is normal if nothing changed since last sync. For a first sync, verify you have .md files in your vault.',
					},
				],
			},
		],
	},

	// 12. Keyboard Shortcuts
	{
		id: 'keyboard-shortcuts',
		title: 'Keyboard Shortcuts',
		icon: 'keyboard',
		defaultOpen: false,
		content: [
			{
				type: 'paragraph',
				text: 'All Lumen commands are available via the command palette (Ctrl/Cmd+P). You can assign custom hotkeys to any command in Settings \u2192 Hotkeys.',
			},
			{
				type: 'shortcuts-table',
				rows: [
					{ command: 'Lumen: Open Lumen', description: 'Opens the Lumen sidebar (search, chat, related).' },
					{ command: 'Lumen: Quick search', description: 'Opens a fast search modal overlay.' },
					{ command: 'Lumen: Focus search input', description: 'Jumps to the search box in the sidebar.' },
					{ command: 'Lumen: Open chat', description: 'Opens or switches to the Chat tab.' },
					{ command: 'Lumen: New chat', description: 'Starts a new chat conversation.' },
					{ command: 'Lumen: Open related notes', description: 'Opens or switches to the Related Notes tab.' },
					{ command: 'Lumen: Toggle search / chat / related', description: 'Cycles between sidebar modes.' },
					{ command: 'Lumen: Find similar notes', description: 'Shows notes similar to the active file.' },
					{ command: 'Lumen: Sync vault with Lumen', description: 'Triggers an immediate manual sync.' },
					{ command: 'Lumen: Cancel active sync', description: 'Cancels a currently running sync.' },
					{ command: 'Lumen: Open Debug Log', description: 'Opens the debug log viewer.' },
					{ command: 'Lumen: View documentation', description: 'Opens this help panel.' },
				],
			},
			{
				type: 'tip',
				text: 'Assign Ctrl/Cmd+Shift+L to "Quick search" for fast vault-wide search from anywhere.',
			},
		],
	},

	// 13. Privacy & Security
	{
		id: 'privacy-security',
		title: 'Privacy & Security',
		icon: 'shield',
		defaultOpen: false,
		content: [
			{ type: 'subheading', text: 'API Key Storage' },
			{
				type: 'warning',
				text: 'Your API key is stored in plaintext in .obsidian/plugins/lumen-search/data.json. Do not share this file or commit it to a public repository.',
			},
			{ type: 'subheading', text: 'What Data is Sent' },
			{
				type: 'unordered-list',
				items: [
					'During sync: Markdown file content, file paths, and SHA-256 hashes.',
					'During search: Your search query text.',
					'During chat: Your messages, conversation history, and the active note\'s content for context.',
					'Metadata: workspace ID, device ID, and plugin version.',
				],
			},
			{ type: 'subheading', text: 'What is NOT Sent' },
			{
				type: 'unordered-list',
				items: [
					'Non-Markdown files (images, PDFs, attachments) are never uploaded.',
					'Files matching exclude patterns are never sent.',
					'Your Obsidian settings, themes, and other plugin data are never accessed.',
				],
			},
			{ type: 'subheading', text: 'Data Handling' },
			{
				type: 'unordered-list',
				items: [
					'All communication uses HTTPS (TLS encryption in transit).',
					'Chat conversations are stored on the Lumen server and associated with your workspace.',
					'Embeddings are generated using AI models for indexing — your content is processed to create searchable vectors.',
				],
			},
		],
	},
];
