/**
 * ConflictBanner — Shows a dismissible banner when sync conflicts exist.
 *
 * Displays at the top of the sidebar with conflict count, an expandable
 * list of affected files, and a link to the full conflict log.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { setIcon } from 'obsidian';
import { useConflicts } from '../hooks/useConflicts';

export function ConflictBanner() {
	const { conflicts, dismiss, openFile, openConflictLog } = useConflicts();
	const [expanded, setExpanded] = useState(false);

	if (conflicts.length === 0) return null;

	return (
		<div className="lumen-conflict-banner">
			<ConflictBannerHeader
				count={conflicts.length}
				expanded={expanded}
				onToggle={() => setExpanded(!expanded)}
				onDismiss={dismiss}
			/>
			{expanded && (
				<div className="lumen-conflict-list">
					{conflicts.map((c, i) => (
						<ConflictItem
							key={`${c.path}-${i}`}
							path={c.path}
							type={c.type}
							resolution={c.resolution}
							onOpen={() => openFile(c.path)}
						/>
					))}
					<button
						className="lumen-conflict-log-link"
						onClick={openConflictLog}
					>
						View full conflict log
					</button>
				</div>
			)}
		</div>
	);
}

interface ConflictBannerHeaderProps {
	count: number;
	expanded: boolean;
	onToggle: () => void;
	onDismiss: () => void;
}

function ConflictBannerHeader({ count, expanded, onToggle, onDismiss }: ConflictBannerHeaderProps) {
	const warningRef = useRef<HTMLSpanElement>(null);
	const chevronRef = useRef<HTMLSpanElement>(null);
	const dismissRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (warningRef.current) setIcon(warningRef.current, 'alert-triangle');
		if (dismissRef.current) setIcon(dismissRef.current, 'x');
	}, []);

	useEffect(() => {
		if (chevronRef.current) setIcon(chevronRef.current, expanded ? 'chevron-down' : 'chevron-right');
	}, [expanded]);

	const handleDismiss = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		onDismiss();
	}, [onDismiss]);

	return (
		<div className="lumen-conflict-header" onClick={onToggle}>
			<span className="lumen-conflict-warning-icon" ref={warningRef} />
			<span className="lumen-conflict-header-text">
				{count} sync conflict{count === 1 ? '' : 's'}
			</span>
			<span className="lumen-conflict-chevron" ref={chevronRef} />
			<button
				className="lumen-conflict-dismiss"
				aria-label="Dismiss conflicts"
				ref={dismissRef}
				onClick={handleDismiss}
			/>
		</div>
	);
}

interface ConflictItemProps {
	path: string;
	type: string;
	resolution: string;
	onOpen: () => void;
}

function ConflictItem({ path, type, resolution, onOpen }: ConflictItemProps) {
	const iconRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, 'file-text');
	}, []);

	const displayPath = path
		.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i, '')
		.replace(/^\/+/, '');

	const typeLabel = type === 'both-modified' ? 'Both modified'
		: type === 'server-modified' ? 'Server modified'
		: 'Local modified';

	const resolutionLabel = resolution === 'server-kept' ? 'Server version kept' : 'Local version kept';

	return (
		<div className="lumen-conflict-item" onClick={onOpen}>
			<span className="lumen-conflict-item-icon" ref={iconRef} />
			<div className="lumen-conflict-item-info">
				<span className="lumen-conflict-item-path">{displayPath}</span>
				<span className="lumen-conflict-item-detail">{typeLabel} — {resolutionLabel}</span>
			</div>
		</div>
	);
}
