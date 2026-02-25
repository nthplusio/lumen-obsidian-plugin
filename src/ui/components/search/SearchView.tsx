/**
 * SearchView — Full search interface with debounced queries, tag filtering,
 * hybrid mode toggle, results with markdown snippets, and classified errors.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownRenderer, setIcon } from 'obsidian';
import type { SearchResult } from '../../../types';
import { usePlugin } from '../../contexts/PluginContext';
import { useSearch } from '../../hooks/useSearch';
import { EmptyState, ErrorState, TagChip } from '../shared';

export function SearchView() {
	const search = useSearch();
	const { state } = search;

	return (
		<div className="lumen-search-view">
			<SearchInput
				query={state.query}
				onChange={search.onQueryChange}
			/>
			<SearchToolbar
				hybridMode={state.hybridMode}
				onToggleHybrid={search.toggleHybrid}
				tagFilterOpen={state.tagFilterOpen}
				onToggleTagFilter={search.toggleTagFilter}
				historyOpen={state.historyOpen}
				hasHistory={state.recentQueries.length > 0}
				onToggleHistory={search.toggleHistory}
			/>
			{state.historyOpen && state.recentQueries.length > 0 && (
				<SearchHistory
					queries={state.recentQueries}
					onSelect={search.selectHistoryQuery}
				/>
			)}
			{state.tagFilterOpen && (
				<TagFilterPanel
					tagCache={state.tagCache}
					selectedTags={state.selectedTags}
					onAddTag={search.addTag}
					onRemoveTag={search.removeTag}
				/>
			)}
			<SearchStatus status={state.status} retryAttempt={state.retryAttempt} resultCount={state.results.length} />
			<SearchResults
				state={state}
				onRetry={search.retry}
			/>
		</div>
	);
}

// --- SearchInput ---

function SearchInput({ query, onChange }: { query: string; onChange: (q: string) => void }) {
	const iconRef = useRef<HTMLSpanElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, 'search');
	}, []);

	return (
		<div className="lumen-search-area">
			<div className="lumen-input-wrapper">
				<span className="lumen-search-icon" ref={iconRef} />
				<input
					ref={inputRef}
					type="text"
					className="lumen-search-input"
					placeholder="Search your vault..."
					value={query}
					onChange={e => onChange(e.target.value)}
					onKeyDown={e => { if (e.key === 'Escape') inputRef.current?.blur(); }}
				/>
			</div>
		</div>
	);
}

// --- SearchToolbar ---

interface SearchToolbarProps {
	hybridMode: boolean;
	onToggleHybrid: () => void;
	tagFilterOpen: boolean;
	onToggleTagFilter: () => void;
	historyOpen: boolean;
	hasHistory: boolean;
	onToggleHistory: () => void;
}

function SearchToolbar({ hybridMode, onToggleHybrid, tagFilterOpen, onToggleTagFilter, historyOpen, hasHistory, onToggleHistory }: SearchToolbarProps) {
	const zapRef = useRef<HTMLElement>(null);
	const tagRef = useRef<HTMLElement>(null);
	const historyRef = useRef<HTMLElement>(null);

	useEffect(() => {
		if (zapRef.current) setIcon(zapRef.current, 'zap');
		if (tagRef.current) setIcon(tagRef.current, 'tag');
		if (historyRef.current) setIcon(historyRef.current, 'history');
	}, []);

	return (
		<div className="lumen-search-toolbar">
			<button
				className={`lumen-hybrid-toggle ${hybridMode ? 'is-active' : ''}`}
				aria-label="Toggle hybrid search"
				aria-pressed={hybridMode}
				onClick={onToggleHybrid}
			>
				<span ref={zapRef} />
				<span className="lumen-hybrid-label">Hybrid</span>
			</button>
			<button
				className={`lumen-tags-toggle ${tagFilterOpen ? 'is-active' : ''}`}
				aria-label="Filter by tags"
				aria-pressed={tagFilterOpen}
				onClick={onToggleTagFilter}
			>
				<span ref={tagRef} />
				<span className="lumen-tags-label">Tags</span>
			</button>
			{hasHistory && (
				<button
					className={`lumen-history-toggle ${historyOpen ? 'is-active' : ''}`}
					aria-label="Recent searches"
					aria-pressed={historyOpen}
					onClick={onToggleHistory}
				>
					<span ref={historyRef} />
					<span className="lumen-history-label">History</span>
				</button>
			)}
		</div>
	);
}

// --- TagFilterPanel ---

interface TagFilterPanelProps {
	tagCache: Array<{ tag: string; count: number }> | null;
	selectedTags: string[];
	onAddTag: (tag: string) => void;
	onRemoveTag: (tag: string) => void;
}

function TagFilterPanel({ tagCache, selectedTags, onAddTag, onRemoveTag }: TagFilterPanelProps) {
	const [tagQuery, setTagQuery] = useState('');
	const [showDropdown, setShowDropdown] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout>>();

	const filtered = tagCache
		?.filter(t => t.tag.toLowerCase().includes(tagQuery.toLowerCase()) && !selectedTags.includes(t.tag))
		.slice(0, 50) ?? [];

	const handleInput = useCallback((value: string) => {
		setTagQuery(value);
		if (debounceRef.current) clearTimeout(debounceRef.current);

		if (!value.trim()) {
			setShowDropdown(false);
			return;
		}

		debounceRef.current = setTimeout(() => setShowDropdown(true), 300);
	}, []);

	const handleSelect = useCallback((tag: string) => {
		onAddTag(tag);
		setTagQuery('');
		setShowDropdown(false);
	}, [onAddTag]);

	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, []);

	return (
		<div className="lumen-tag-filter-panel">
			<div className="lumen-tag-chips">
				{selectedTags.map(tag => (
					<TagChip key={tag} tag={tag} onRemove={onRemoveTag} />
				))}
			</div>
			<div className="lumen-tag-input-wrapper">
				<input
					ref={inputRef}
					type="text"
					className="lumen-tag-autocomplete-input"
					placeholder="Filter by tag..."
					value={tagQuery}
					onChange={e => handleInput(e.target.value)}
					onKeyDown={e => {
						if (e.key === 'Escape') {
							setShowDropdown(false);
							inputRef.current?.blur();
						}
					}}
				/>
				{showDropdown && filtered.length > 0 && (
					<div className="lumen-tag-dropdown">
						{filtered.map(item => (
							<div
								key={item.tag}
								className="lumen-tag-dropdown-item"
								onClick={() => handleSelect(item.tag)}
							>
								<span className="lumen-tag-dropdown-name">{item.tag}</span>
								<span className="lumen-tag-dropdown-count">{item.count}</span>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

// --- SearchHistory ---

function SearchHistory({ queries, onSelect }: { queries: string[]; onSelect: (q: string) => void }) {
	return (
		<div className="lumen-search-history">
			{queries.map(q => (
				<button
					key={q}
					className="lumen-search-history-item"
					onClick={() => onSelect(q)}
				>
					<span className="lumen-search-history-text">{q}</span>
				</button>
			))}
		</div>
	);
}

// --- SearchStatus ---

function SearchStatus({ status, retryAttempt, resultCount }: { status: string; retryAttempt: number; resultCount: number }) {
	if (status === 'loading') {
		return (
			<div className="lumen-search-status">
				<span className="lumen-searching">Searching...</span>
			</div>
		);
	}
	if (status === 'retrying') {
		return (
			<div className="lumen-search-status">
				<span className="lumen-searching">Retrying (attempt {retryAttempt})...</span>
			</div>
		);
	}
	if (status === 'done' && resultCount > 0) {
		return (
			<div className="lumen-search-status">
				<span className="lumen-result-count">
					{resultCount} result{resultCount === 1 ? '' : 's'}
				</span>
			</div>
		);
	}
	return <div className="lumen-search-status" />;
}

// --- SearchResults ---

interface SearchResultsProps {
	state: ReturnType<typeof useSearch>['state'];
	onRetry: () => void;
}

function SearchResults({ state, onRetry }: SearchResultsProps) {
	if (state.status === 'idle') {
		return (
			<div className="lumen-results">
				<EmptyState
					icon="search"
					title="Search your vault with natural language"
					hint='Try: "notes about project planning" or "meeting with Sarah"'
				/>
			</div>
		);
	}

	if (state.status === 'no-results') {
		return (
			<div className="lumen-results">
				<EmptyState
					icon="search-x"
					title={`No results for "${state.query}"`}
					hint="Try different keywords or a broader search"
				/>
			</div>
		);
	}

	if (state.status === 'not-configured') {
		return (
			<div className="lumen-results">
				<ConfigError />
			</div>
		);
	}

	if (state.status === 'error' && state.error) {
		return (
			<div className="lumen-results">
				<ErrorState error={state.error} onRetry={onRetry} />
			</div>
		);
	}

	if (state.results.length > 0) {
		return (
			<div className="lumen-results">
				{state.results.map((result, i) => (
					<ResultItem key={`${result.source_path}-${result.chunk_index}-${i}`} result={result} query={state.query} />
				))}
			</div>
		);
	}

	return <div className="lumen-results" />;
}

// --- ConfigError ---

function ConfigError() {
	const { app } = usePlugin();
	const iconRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, 'settings');
	}, []);

	const handleOpenSettings = useCallback(() => {
		(app as any).setting?.open?.();
		(app as any).setting?.openTabById?.('lumen-search');
	}, [app]);

	return (
		<div className="lumen-error-state">
			<div className="lumen-error-icon" ref={iconRef} />
			<p className="lumen-error-title">Not configured</p>
			<p className="lumen-error-detail">Set your API URL and key to start searching.</p>
			<button className="lumen-settings-link" onClick={handleOpenSettings}>
				Open Settings
			</button>
		</div>
	);
}

// --- ResultItem ---

function ResultItem({ result, query }: { result: SearchResult; query: string }) {
	const { app } = usePlugin();
	const fileIconRef = useRef<HTMLSpanElement>(null);
	const previewRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (fileIconRef.current) setIcon(fileIconRef.current, 'file-text');
		if (previewRef.current) setIcon(previewRef.current, 'panel-right');
	}, []);

	const title = result.heading_hierarchy?.[0]
		|| filenameFromPath(result.source_path);

	const displayPath = stripWorkspacePrefix(result.source_path).replace(/\.md$/, '');
	const scorePercent = Math.round(result.score * 100);
	const scoreCls = scorePercent >= 80 ? 'lumen-score-high'
		: scorePercent >= 50 ? 'lumen-score-medium'
		: 'lumen-score-low';

	const handleClick = useCallback(() => {
		openDocument(app, result.source_path);
	}, [app, result.source_path]);

	const handlePreview = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		const normalizedPath = stripWorkspacePrefix(result.source_path.replace(/^\/+/, ''));
		// Open in a split pane to the right
		const leaf = app.workspace.getLeaf('split');
		if (leaf) {
			app.workspace.openLinkText(normalizedPath, '', false, { active: true });
		}
	}, [app, result.source_path]);

	const tags = result.frontmatter?.tags as string[] | undefined;

	return (
		<div className="lumen-result-item" onClick={handleClick}>
			<div className="lumen-result-title-row">
				<div className="lumen-result-title-left">
					<span className="lumen-result-file-icon" ref={fileIconRef} />
					<span className="lumen-result-title">{title}</span>
				</div>
				<button
					className="lumen-result-preview-btn"
					aria-label="Open to the right"
					title="Open to the right"
					ref={previewRef}
					onClick={handlePreview}
				/>
				<span className={`lumen-result-score ${scoreCls}`}>{scorePercent}%</span>
				{result.matching_chunks && result.matching_chunks > 1 && (
					<span className="lumen-result-chunks">{result.matching_chunks} sections</span>
				)}
			</div>
			{displayPath !== title && (
				<div className="lumen-result-path">{displayPath}</div>
			)}
			{result.content && (
				<Snippet text={result.content} query={query} />
			)}
			{tags && tags.length > 0 && (
				<ResultTags tags={tags.slice(0, 5)} />
			)}
		</div>
	);
}

// --- Snippet ---

function Snippet({ text, query }: { text: string; query: string }) {
	const { app, component } = usePlugin();
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!ref.current) return;
		ref.current.empty();

		const maxLen = 250;
		let snippet = text.replace(/\n{3,}/g, '\n\n').trim();
		if (snippet.length > maxLen) {
			snippet = snippet.slice(0, maxLen) + '...';
		}

		MarkdownRenderer.render(app, snippet, ref.current, '', component);

		// Highlight query terms
		highlightTerms(ref.current, query);
	}, [text, query, app, component]);

	return <div className="lumen-result-snippet" ref={ref} />;
}

// --- ResultTags ---

function ResultTags({ tags }: { tags: string[] }) {
	return (
		<div className="lumen-result-tags">
			{tags.map(tag => (
				<ResultTag key={tag} tag={tag} />
			))}
		</div>
	);
}

function ResultTag({ tag }: { tag: string }) {
	const iconRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, 'hash');
	}, []);

	return (
		<span className="lumen-tag">
			<span className="lumen-tag-icon" ref={iconRef} />
			<span>{tag.replace(/^#/, '')}</span>
		</span>
	);
}

// --- Utility functions ---

function filenameFromPath(path: string): string {
	return path.split('/').pop()?.replace(/\.md$/, '') ?? path;
}

function stripWorkspacePrefix(path: string): string {
	return path.replace(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i,
		'',
	);
}

async function openDocument(app: any, documentPath: string): Promise<void> {
	const normalizedPath = stripWorkspacePrefix(documentPath.replace(/^\/+/, ''));

	const file = app.vault.getAbstractFileByPath(normalizedPath);
	if (file) {
		await app.workspace.openLinkText(normalizedPath, '', false);
		return;
	}

	const withMd = normalizedPath.endsWith('.md') ? normalizedPath : normalizedPath + '.md';
	const withoutMd = normalizedPath.replace(/\.md$/, '');

	const altFile = app.vault.getAbstractFileByPath(withMd)
		|| app.vault.getAbstractFileByPath(withoutMd);

	if (altFile) {
		await app.workspace.openLinkText(altFile.path, '', false);
	}
}

function highlightTerms(el: HTMLElement, query: string): void {
	const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
	if (terms.length === 0) return;

	const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');

	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	const textNodes: Text[] = [];
	let node: Text | null;
	while ((node = walker.nextNode() as Text | null)) {
		if (node.textContent && pattern.test(node.textContent)) {
			textNodes.push(node);
		}
		pattern.lastIndex = 0;
	}

	for (const textNode of textNodes) {
		const content = textNode.textContent || '';
		const fragment = document.createDocumentFragment();
		const parts = content.split(pattern);

		for (const part of parts) {
			pattern.lastIndex = 0;
			if (pattern.test(part)) {
				const mark = document.createElement('mark');
				mark.className = 'lumen-highlight';
				mark.textContent = part;
				fragment.appendChild(mark);
			} else {
				fragment.appendChild(document.createTextNode(part));
			}
			pattern.lastIndex = 0;
		}

		textNode.parentNode?.replaceChild(fragment, textNode);
	}
}
