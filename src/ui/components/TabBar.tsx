/**
 * TabBar — Search/Chat/Related mode switching.
 *
 * Renders tab buttons with Obsidian icons. Uses setIcon via useEffect+ref
 * to render SVG icons from Obsidian's icon set.
 *
 * In compact mode (mobile), renders icon-only tabs without labels or background.
 */

import { useCallback, useEffect, useRef } from 'react';
import { setIcon } from 'obsidian';

export type ViewMode = 'search' | 'chat' | 'related';

interface TabBarProps {
	activeMode: ViewMode;
	onModeChange: (mode: ViewMode) => void;
	compact?: boolean;
}

export function TabBar({ activeMode, onModeChange, compact }: TabBarProps) {
	const searchIconRef = useRef<HTMLSpanElement>(null);
	const chatIconRef = useRef<HTMLSpanElement>(null);
	const relatedIconRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (searchIconRef.current) setIcon(searchIconRef.current, 'search');
		if (chatIconRef.current) setIcon(chatIconRef.current, 'message-circle');
		if (relatedIconRef.current) setIcon(relatedIconRef.current, 'git-branch');
	}, []);

	const handleSearchClick = useCallback(() => onModeChange('search'), [onModeChange]);
	const handleChatClick = useCallback(() => onModeChange('chat'), [onModeChange]);
	const handleRelatedClick = useCallback(() => onModeChange('related'), [onModeChange]);

	const className = compact
		? 'lumen-tab-bar lumen-tab-bar-compact'
		: 'lumen-tab-bar';

	return (
		<div className={className}>
			<button
				className={`lumen-tab ${activeMode === 'search' ? 'lumen-tab-active' : ''}`}
				data-mode="search"
				onClick={handleSearchClick}
			>
				<span className="lumen-tab-icon" ref={searchIconRef} />
				<span className="lumen-tab-label">Search</span>
			</button>
			<button
				className={`lumen-tab ${activeMode === 'chat' ? 'lumen-tab-active' : ''}`}
				data-mode="chat"
				onClick={handleChatClick}
			>
				<span className="lumen-tab-icon" ref={chatIconRef} />
				<span className="lumen-tab-label">Chat</span>
			</button>
			<button
				className={`lumen-tab ${activeMode === 'related' ? 'lumen-tab-active' : ''}`}
				data-mode="related"
				onClick={handleRelatedClick}
			>
				<span className="lumen-tab-icon" ref={relatedIconRef} />
				<span className="lumen-tab-label">Related</span>
			</button>
		</div>
	);
}
