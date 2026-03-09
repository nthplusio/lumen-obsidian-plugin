/**
 * UpgradeRequiredView — Shown when a feature requires an active subscription.
 *
 * Displays a lock icon, heading, description, and a link to the Lumen dashboard.
 * Follows the OnboardingView visual pattern (centered, padded, icon).
 */

import { useEffect, useRef } from 'react';
import { setIcon } from 'obsidian';
import { usePlugin } from '../contexts/PluginContext';
import { LUMEN_API_URL } from '../../types';

interface UpgradeRequiredViewProps {
	feature: 'chat';
}

export function UpgradeRequiredView({ feature }: UpgradeRequiredViewProps) {
	const { plugin } = usePlugin();
	const iconRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, 'lock');
	}, []);

	const featureLabel = feature === 'chat' ? 'Chat' : feature;
	const baseUrl = plugin.settings.serverUrl || LUMEN_API_URL;

	return (
		<div className="lumen-upgrade-required">
			<div className="lumen-upgrade-required-icon" ref={iconRef} />
			<h2 className="lumen-upgrade-required-title">
				{featureLabel} requires a subscription
			</h2>
			<p className="lumen-upgrade-required-desc">
				Sign up for a free plan to unlock {featureLabel.toLowerCase()} and other features.
			</p>
			<a
				className="lumen-upgrade-required-cta"
				href={baseUrl}
				target="_blank"
				rel="noopener noreferrer"
			>
				Sign Up
			</a>
		</div>
	);
}
