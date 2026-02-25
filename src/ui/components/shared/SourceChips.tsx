/**
 * SourceChips — Clickable source file references.
 *
 * Renders a list of source paths as chips. Clicking opens the file
 * in Obsidian via app.workspace.openLinkText(). ChatSource objects
 * show a relevance score badge.
 */

import { useCallback, useEffect, useRef } from 'react';
import { setIcon } from 'obsidian';
import type { ChatSource } from '../../../types';
import { usePlugin } from '../../contexts/PluginContext';

interface SourceChipsProps {
	sources: Array<string | ChatSource>;
}

function getPath(source: string | ChatSource): string {
	return typeof source === 'string' ? source : source.path;
}

function getScore(source: string | ChatSource): number | undefined {
	return typeof source === 'string' ? undefined : source.score;
}

function SourceChip({ source }: { source: string | ChatSource }) {
	const { app } = usePlugin();
	const iconRef = useRef<HTMLSpanElement>(null);

	const path = getPath(source);
	const score = getScore(source);
	// Show just the filename without extension for display
	const displayName = path.split('/').pop()?.replace(/\.md$/, '') ?? path;

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, 'file-text');
	}, []);

	const handleClick = useCallback(() => {
		app.workspace.openLinkText(path, '', false);
	}, [app, path]);

	return (
		<button
			className="lumen-source-chip"
			onClick={handleClick}
			title={path}
		>
			<span className="lumen-source-chip-icon" ref={iconRef} />
			<span className="lumen-source-chip-name">{displayName}</span>
			{score !== undefined && (
				<span className="lumen-source-chip-score">
					{Math.round(score * 100)}%
				</span>
			)}
		</button>
	);
}

export function SourceChips({ sources }: SourceChipsProps) {
	if (!sources.length) return null;

	return (
		<div className="lumen-source-chips">
			{sources.map((source, i) => (
				<SourceChip key={`${getPath(source)}-${i}`} source={source} />
			))}
		</div>
	);
}
