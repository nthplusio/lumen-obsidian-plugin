/**
 * ErrorState — Classified error display with contextual action buttons.
 *
 * Shows icon, title, detail message, and appropriate actions based on
 * error category (retry, open settings, test connection).
 */

import { useEffect, useRef, useCallback } from 'react';
import { Notice, setIcon } from 'obsidian';
import type { ClassifiedError } from '../../../utils/error-classifier';
import { usePlugin } from '../../contexts/PluginContext';

interface ErrorStateProps {
	error: ClassifiedError;
	onRetry?: () => void;
}

function errorTitle(category: ClassifiedError['category']): string {
	switch (category) {
		case 'auth': return 'Authentication Error';
		case 'network': return 'Connection Error';
		case 'timeout': return 'Connection Error';
		case 'rate-limit': return 'Rate Limited';
		case 'config': return 'Configuration Error';
		default: return 'Error';
	}
}

function errorIcon(category: ClassifiedError['category']): string {
	switch (category) {
		case 'auth': return 'key';
		case 'config': return 'settings';
		default: return 'alert-triangle';
	}
}

export function ErrorState({ error, onRetry }: ErrorStateProps) {
	const { plugin, app } = usePlugin();
	const iconRef = useRef<HTMLDivElement>(null);

	const icon = errorIcon(error.category);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, icon);
	}, [icon]);

	const handleOpenSettings = useCallback(() => {
		(app as any).setting?.open?.();
		(app as any).setting?.openTabById?.('lumen-search');
	}, [app]);

	const handleTestConnection = useCallback(async () => {
		try {
			const status = await plugin.apiClient.testConnection();
			new Notice(`Connected to Lumen v${status.version} (${status.status})`);
		} catch {
			new Notice('Connection failed. Server may be unreachable.');
		}
	}, [plugin]);

	const showRetry = error.retryable && onRetry;
	const showSettings = error.category === 'auth' || error.category === 'config';
	const showTestConnection =
		error.category === 'network' ||
		error.category === 'server' ||
		error.category === 'timeout';

	return (
		<div className="lumen-error-state">
			<div className="lumen-error-icon" ref={iconRef} />
			<p className="lumen-error-title">{errorTitle(error.category)}</p>
			<p className="lumen-error-detail">{error.message}</p>
			<div className="lumen-error-actions">
				{showRetry && (
					<button className="lumen-retry-button" onClick={onRetry}>
						Retry
					</button>
				)}
				{showSettings && (
					<button className="lumen-settings-link" onClick={handleOpenSettings}>
						Open Settings
					</button>
				)}
				{showTestConnection && (
					<button className="lumen-test-button" onClick={handleTestConnection}>
						Test Connection
					</button>
				)}
			</div>
		</div>
	);
}
