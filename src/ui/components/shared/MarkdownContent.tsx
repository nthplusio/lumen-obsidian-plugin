/**
 * MarkdownContent — Bridge to Obsidian's MarkdownRenderer.render().
 *
 * Renders markdown into a container div using Obsidian's built-in renderer,
 * which handles wiki-links, embeds, and syntax highlighting. The Component
 * parameter from PluginContext is required for link resolution.
 */

import { useEffect, useRef } from 'react';
import { MarkdownRenderer } from 'obsidian';
import { usePlugin } from '../../contexts/PluginContext';

interface MarkdownContentProps {
	markdown: string;
	sourcePath?: string;
	className?: string;
}

export function MarkdownContent({
	markdown,
	sourcePath = '',
	className,
}: MarkdownContentProps) {
	const { app, component } = usePlugin();
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;

		// Clear previous content
		el.empty();

		// Render markdown using Obsidian's renderer
		MarkdownRenderer.render(app, markdown, el, sourcePath, component);
	}, [markdown, sourcePath, app, component]);

	return (
		<div
			ref={containerRef}
			className={`lumen-markdown-content ${className ?? ''}`}
		/>
	);
}
