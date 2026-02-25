/**
 * RelatedNotesView — Shows semantically similar notes to the active file.
 *
 * Auto-updates when the user switches between files. Uses debounced
 * API calls with in-memory caching to stay responsive.
 */

import { useCallback, useEffect, useRef } from 'react';
import { MarkdownRenderer, setIcon } from 'obsidian';
import type { SearchResult } from '../../../types';
import { usePlugin } from '../../contexts/PluginContext';
import { useRelatedNotes } from '../../hooks/useRelatedNotes';
import { EmptyState, ErrorState } from '../shared';

export function RelatedNotesView() {
	const related = useRelatedNotes();
	const { state } = related;

	return (
		<div className="lumen-related-view">
			{state.activeFileName && (
				<RelatedHeader fileName={state.activeFileName} resultCount={state.results.length} status={state.status} />
			)}
			<RelatedContent state={state} onRetry={related.retry} />
		</div>
	);
}

// --- RelatedHeader ---

function RelatedHeader({ fileName, resultCount, status }: { fileName: string; resultCount: number; status: string }) {
	const iconRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, 'file-text');
	}, []);

	return (
		<div className="lumen-related-header">
			<div className="lumen-related-header-file">
				<span className="lumen-related-header-icon" ref={iconRef} />
				<span className="lumen-related-header-name">{fileName}</span>
			</div>
			{status === 'done' && resultCount > 0 && (
				<span className="lumen-related-header-count">
					{resultCount} related
				</span>
			)}
			{status === 'loading' && (
				<span className="lumen-related-header-loading">Searching...</span>
			)}
		</div>
	);
}

// --- RelatedContent ---

function RelatedContent({ state, onRetry }: { state: ReturnType<typeof useRelatedNotes>['state']; onRetry: () => void }) {
	if (state.status === 'no-file' || (state.status === 'idle' && !state.activePath)) {
		return (
			<div className="lumen-related-body">
				<EmptyState
					icon="file-search"
					title="Open a note to see related content"
					hint="Related notes will appear here when you're viewing a markdown file"
				/>
			</div>
		);
	}

	if (state.status === 'not-configured') {
		return (
			<div className="lumen-related-body">
				<EmptyState
					icon="settings"
					title="Not configured"
					hint="Set your API key in Settings → Lumen to find related notes"
				/>
			</div>
		);
	}

	if (state.status === 'loading') {
		return (
			<div className="lumen-related-body">
				<div className="lumen-related-loading">
					<span className="lumen-searching">Finding related notes...</span>
				</div>
			</div>
		);
	}

	if (state.status === 'no-results') {
		return (
			<div className="lumen-related-body">
				<EmptyState
					icon="search-x"
					title="No related notes found"
					hint="This note may not share enough content with other indexed notes"
				/>
			</div>
		);
	}

	if (state.status === 'error' && state.error) {
		return (
			<div className="lumen-related-body">
				<ErrorState error={state.error} onRetry={onRetry} />
			</div>
		);
	}

	if (state.results.length > 0) {
		return (
			<div className="lumen-related-body">
				{state.results.map((result, i) => (
					<RelatedItem
						key={`${result.source_path}-${result.chunk_index}-${i}`}
						result={result}
					/>
				))}
			</div>
		);
	}

	return <div className="lumen-related-body" />;
}

// --- RelatedItem ---

function RelatedItem({ result }: { result: SearchResult }) {
	const { app } = usePlugin();
	const fileIconRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (fileIconRef.current) setIcon(fileIconRef.current, 'file-text');
	}, []);

	const title = result.heading_hierarchy?.[0]
		|| filenameFromPath(result.source_path);

	const displayPath = stripWorkspacePrefix(result.source_path).replace(/\.md$/, '');
	const scorePercent = Math.round(result.score * 100);
	const scoreCls = scorePercent >= 80 ? 'lumen-score-high'
		: scorePercent >= 50 ? 'lumen-score-medium'
		: 'lumen-score-low';

	const handleClick = useCallback(() => {
		const normalizedPath = stripWorkspacePrefix(result.source_path.replace(/^\/+/, ''));
		app.workspace.openLinkText(normalizedPath, '', false);
	}, [app, result.source_path]);

	return (
		<div className="lumen-related-item" onClick={handleClick}>
			<div className="lumen-related-item-title-row">
				<div className="lumen-related-item-title-left">
					<span className="lumen-related-item-icon" ref={fileIconRef} />
					<span className="lumen-related-item-title">{title}</span>
				</div>
				<span className={`lumen-result-score ${scoreCls}`}>{scorePercent}%</span>
			</div>
			{displayPath !== title && (
				<div className="lumen-related-item-path">{displayPath}</div>
			)}
			{result.content && (
				<RelatedSnippet text={result.content} />
			)}
		</div>
	);
}

// --- RelatedSnippet ---

function RelatedSnippet({ text }: { text: string }) {
	const { app, component } = usePlugin();
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!ref.current) return;
		ref.current.empty();

		const maxLen = 180;
		let snippet = text.replace(/\n{3,}/g, '\n\n').trim();
		if (snippet.length > maxLen) {
			snippet = snippet.slice(0, maxLen) + '...';
		}

		MarkdownRenderer.render(app, snippet, ref.current, '', component);
	}, [text, app, component]);

	return <div className="lumen-related-item-snippet" ref={ref} />;
}

// --- Utilities ---

function filenameFromPath(path: string): string {
	return path.split('/').pop()?.replace(/\.md$/, '') ?? path;
}

function stripWorkspacePrefix(path: string): string {
	return path.replace(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i,
		'',
	);
}
