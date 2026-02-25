/**
 * TabBar — Search/Chat mode switching.
 *
 * Renders two tab buttons with Obsidian icons. Uses setIcon via useEffect+ref
 * to render SVG icons from Obsidian's icon set.
 */

import { useCallback, useEffect, useRef } from 'react';
import { setIcon } from 'obsidian';

export type ViewMode = 'search' | 'chat';

interface TabBarProps {
	activeMode: ViewMode;
	onModeChange: (mode: ViewMode) => void;
}

export function TabBar({ activeMode, onModeChange }: TabBarProps) {
	const searchIconRef = useRef<HTMLSpanElement>(null);
	const chatIconRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (searchIconRef.current) setIcon(searchIconRef.current, 'search');
		if (chatIconRef.current) setIcon(chatIconRef.current, 'message-circle');
	}, []);

	const handleSearchClick = useCallback(() => onModeChange('search'), [onModeChange]);
	const handleChatClick = useCallback(() => onModeChange('chat'), [onModeChange]);

	return (
		<div className="lumen-tab-bar">
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
		</div>
	);
}
