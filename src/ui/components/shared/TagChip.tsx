/**
 * TagChip — Tag display with optional remove button.
 * Used in search tag filter panel and result items.
 */

import { useEffect, useRef, useCallback } from 'react';
import { setIcon } from 'obsidian';

interface TagChipProps {
	tag: string;
	onRemove?: (tag: string) => void;
}

export function TagChip({ tag, onRemove }: TagChipProps) {
	const hashIconRef = useRef<HTMLSpanElement>(null);
	const removeIconRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (hashIconRef.current) setIcon(hashIconRef.current, 'hash');
	}, []);

	useEffect(() => {
		if (removeIconRef.current && onRemove) setIcon(removeIconRef.current, 'x');
	}, [onRemove]);

	const handleRemove = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			onRemove?.(tag);
		},
		[onRemove, tag],
	);

	return (
		<span className="lumen-tag-chip">
			<span className="lumen-tag-chip-icon" ref={hashIconRef} />
			<span className="lumen-tag-chip-text">{tag.replace(/^#/, '')}</span>
			{onRemove && (
				<span
					className="lumen-tag-chip-remove"
					aria-label={`Remove ${tag}`}
					ref={removeIconRef}
					onClick={handleRemove}
				/>
			)}
		</span>
	);
}
