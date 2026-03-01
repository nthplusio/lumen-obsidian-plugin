/**
 * SidebarHeader — Brand header row for the Lumen sidebar.
 *
 * Renders the full-color Lumen icon + title on the left,
 * and a help button on the right that opens LumenHelpModal.
 */

import { useCallback, useEffect, useRef } from 'react';
import { setIcon } from 'obsidian';
import { LUMEN_BRAND_SVG } from '../../icons';
import { LumenHelpModal } from '../../help-modal';
import { usePlugin } from '../contexts/PluginContext';

export function SidebarHeader() {
	const { app } = usePlugin();
	const iconRef = useRef<HTMLSpanElement>(null);
	const helpRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (iconRef.current) {
			// Static trusted SVG constant — not user input
			iconRef.current.innerHTML = LUMEN_BRAND_SVG;
		}
	}, []);

	useEffect(() => {
		if (helpRef.current) {
			setIcon(helpRef.current, 'help-circle');
		}
	}, []);

	const handleHelp = useCallback(() => {
		new LumenHelpModal(app).open();
	}, [app]);

	return (
		<div className="lumen-sidebar-header">
			<div className="lumen-sidebar-header-brand">
				<span ref={iconRef} className="lumen-sidebar-header-icon" />
				<span className="lumen-sidebar-header-title">Lumen</span>
			</div>
			<button
				ref={helpRef}
				className="lumen-sidebar-header-help"
				onClick={handleHelp}
				aria-label="Help"
			/>
		</div>
	);
}
