/**
 * QuickSearchContent — React content for the quick search modal.
 *
 * Features:
 *   - Search-as-you-type with debounce
 *   - Arrow key navigation through results
 *   - Enter to open selected result
 *   - Escape to close modal
 *   - Compact result rendering with score badges
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { setIcon } from 'obsidian';
import type { App } from 'obsidian';
import type LumenPlugin from '../../../main';
import type { SearchResult } from '../../../types';
import { classifyError } from '../../../utils/error-classifier';
import { ErrorBoundary } from '../shared';

const DEBOUNCE_MS = 200;

interface QuickSearchContentProps {
	plugin: LumenPlugin;
	app: App;
	onClose: () => void;
}

type SearchStatus = 'idle' | 'loading' | 'done' | 'no-results' | 'error';

export function QuickSearchContent({ plugin, app, onClose }: QuickSearchContentProps) {
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<SearchResult[]>([]);
	const [status, setStatus] = useState<SearchStatus>('idle');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout>>();
	const resultsRef = useRef<HTMLDivElement>(null);

	// Auto-focus on mount
	useEffect(() => {
		requestAnimationFrame(() => inputRef.current?.focus());
	}, []);

	// Debounced search
	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current);

		const trimmed = query.trim();
		if (!trimmed) {
			setResults([]);
			setStatus('idle');
			setSelectedIndex(0);
			return;
		}

		setStatus('loading');
		debounceRef.current = setTimeout(async () => {
			try {
				const results = await plugin.apiClient.semanticSearch(trimmed, {
					limit: 10,
				});
				setResults(results);
				setStatus(results.length > 0 ? 'done' : 'no-results');
				setSelectedIndex(0);
				setErrorMsg(null);
			} catch (err) {
				const classified = classifyError(err);
				setErrorMsg(classified.message);
				setStatus('error');
			}
		}, DEBOUNCE_MS);

		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [query, plugin]);

	const openResult = useCallback((result: SearchResult) => {
		const path = stripWorkspacePrefix(result.source_path.replace(/^\/+/, ''));
		app.workspace.openLinkText(path, '', false);
		onClose();
	}, [app, onClose]);

	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			setSelectedIndex(i => Math.min(i + 1, results.length - 1));
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			setSelectedIndex(i => Math.max(i - 1, 0));
		} else if (e.key === 'Enter' && results.length > 0) {
			e.preventDefault();
			const result = results[selectedIndex];
			if (result) openResult(result);
		}
	}, [results, selectedIndex, openResult]);

	// Scroll selected item into view
	useEffect(() => {
		if (!resultsRef.current) return;
		const items = resultsRef.current.querySelectorAll('.lumen-qs-result');
		const item = items[selectedIndex] as HTMLElement | undefined;
		item?.scrollIntoView({ block: 'nearest' });
	}, [selectedIndex]);

	return (
		<ErrorBoundary>
			<div className="lumen-qs" onKeyDown={handleKeyDown}>
				<QuickSearchInput
					inputRef={inputRef}
					query={query}
					onChange={setQuery}
					isLoading={status === 'loading'}
				/>
				{status === 'done' && results.length > 0 && (
					<div className="lumen-qs-results" ref={resultsRef}>
						{results.map((result, i) => (
							<QuickSearchResult
								key={`${result.source_path}-${result.chunk_index}`}
								result={result}
								isSelected={i === selectedIndex}
								onClick={() => openResult(result)}
								onHover={() => setSelectedIndex(i)}
							/>
						))}
					</div>
				)}
				{status === 'no-results' && query.trim() && (
					<div className="lumen-qs-empty">
						No results for "{query.trim()}"
					</div>
				)}
				{status === 'error' && errorMsg && (
					<div className="lumen-qs-error">{errorMsg}</div>
				)}
				<QuickSearchFooter />
			</div>
		</ErrorBoundary>
	);
}

// --- QuickSearchInput ---

function QuickSearchInput({
	inputRef,
	query,
	onChange,
	isLoading,
}: {
	inputRef: React.RefObject<HTMLInputElement>;
	query: string;
	onChange: (q: string) => void;
	isLoading: boolean;
}) {
	const iconRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, isLoading ? 'loader' : 'search');
	}, [isLoading]);

	return (
		<div className="lumen-qs-input-row">
			<span className={`lumen-qs-icon ${isLoading ? 'lumen-spin' : ''}`} ref={iconRef} />
			<input
				ref={inputRef}
				type="text"
				className="lumen-qs-input"
				placeholder="Search your vault..."
				value={query}
				onChange={e => onChange(e.target.value)}
				autoComplete="off"
				spellCheck={false}
			/>
		</div>
	);
}

// --- QuickSearchResult ---

function QuickSearchResult({
	result,
	isSelected,
	onClick,
	onHover,
}: {
	result: SearchResult;
	isSelected: boolean;
	onClick: () => void;
	onHover: () => void;
}) {
	const iconRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, 'file-text');
	}, []);

	const title = result.heading_hierarchy?.[0]
		|| filenameFromPath(result.source_path);

	const displayPath = stripWorkspacePrefix(result.source_path).replace(/\.md$/, '');
	const scorePercent = Math.round(result.score * 100);

	return (
		<div
			className={`lumen-qs-result ${isSelected ? 'is-selected' : ''}`}
			onClick={onClick}
			onMouseEnter={onHover}
		>
			<span className="lumen-qs-result-icon" ref={iconRef} />
			<div className="lumen-qs-result-text">
				<span className="lumen-qs-result-title">{title}</span>
				{displayPath !== title && (
					<span className="lumen-qs-result-path">{displayPath}</span>
				)}
			</div>
			<span className="lumen-qs-result-score">{scorePercent}%</span>
		</div>
	);
}

// --- QuickSearchFooter ---

function QuickSearchFooter() {
	return (
		<div className="lumen-qs-footer">
			<span className="lumen-qs-hint">
				<kbd>&uarr;</kbd><kbd>&darr;</kbd> navigate
			</span>
			<span className="lumen-qs-hint">
				<kbd>Enter</kbd> open
			</span>
			<span className="lumen-qs-hint">
				<kbd>Esc</kbd> close
			</span>
		</div>
	);
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
