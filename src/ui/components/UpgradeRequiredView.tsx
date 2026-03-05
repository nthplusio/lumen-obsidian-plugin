/**
 * UpgradeRequiredView — Shown when a feature requires an active subscription.
 *
 * Displays a lock icon, heading, description, and a link to the Lumen dashboard.
 * Follows the OnboardingView visual pattern (centered, padded, icon).
 */

import { useEffect, useRef } from 'react';
import { setIcon } from 'obsidian';
import { LUMEN_API_URL } from '../../types';

interface UpgradeRequiredViewProps {
	feature: 'search' | 'chat';
}

export function UpgradeRequiredView({ feature }: UpgradeRequiredViewProps) {
	const iconRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, 'lock');
	}, []);

	const featureLabel = feature === 'search' ? 'Search' : 'Chat';

	return (
		<div className="lumen-upgrade-required">
			<div className="lumen-upgrade-required-icon" ref={iconRef} />
			<h2 className="lumen-upgrade-required-title">
				{featureLabel} requires a subscription
			</h2>
			<p className="lumen-upgrade-required-desc">
				Upgrade your plan to unlock {featureLabel.toLowerCase()} and other premium features.
			</p>
			<a
				className="lumen-upgrade-required-cta"
				href={LUMEN_API_URL}
				target="_blank"
				rel="noopener noreferrer"
			>
				View Plans
			</a>
		</div>
	);
}
