/**
 * EmptyState — Icon + title + description placeholder.
 * Used by both search (initial state, no results) and chat (no messages).
 */

import { useEffect, useRef } from 'react';
import { setIcon } from 'obsidian';

interface EmptyStateProps {
	icon: string;
	title: string;
	hint?: string;
}

export function EmptyState({ icon, title, hint }: EmptyStateProps) {
	const iconRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, icon);
	}, [icon]);

	return (
		<div className="lumen-empty-state">
			<div className="lumen-empty-icon" ref={iconRef} />
			<p>{title}</p>
			{hint && <p className="lumen-empty-hint">{hint}</p>}
		</div>
	);
}
