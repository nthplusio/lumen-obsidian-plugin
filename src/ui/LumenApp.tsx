/**
 * LumenApp — Root component for the Lumen sidebar.
 *
 * Shows OnboardingView when no API key is configured.
 * Otherwise renders TabBar + the active view (SearchView or ChatView).
 *
 * The sync status strip is rendered in the center of the header,
 * replacing the "Lumen" title text when present.
 *
 * Exposes an imperative API via ref for command-driven actions
 * (focus search, switch tabs, new chat).
 */

import { useCallback, useEffect, useImperativeHandle, useState, forwardRef } from 'react';
import type { PluginContextValue } from './contexts/PluginContext';
import { PluginProvider } from './contexts/PluginContext';
import { TabBar, type ViewMode } from './components/TabBar';
import { SearchView } from './components/search/SearchView';
import { ChatView } from './components/chat/ChatView';
import { RelatedNotesView } from './components/related/RelatedNotesView';
import { OnboardingView } from './components/onboarding/OnboardingView';
import { UpgradeRequiredView } from './components/UpgradeRequiredView';
import { ConflictBanner } from './components/ConflictBanner';
import { SidebarHeader } from './components/SidebarHeader';
import { SyncStatusStrip } from './components/SyncStatusStrip';

/** Imperative API exposed via ref for keyboard shortcuts and commands. */
export interface LumenAppHandle {
	setMode: (mode: ViewMode) => void;
	focusSearch: () => void;
}

interface LumenAppProps {
	context: PluginContextValue;
}

export const LumenApp = forwardRef<LumenAppHandle, LumenAppProps>(
	function LumenApp({ context }, ref) {
		const [activeMode, setActiveMode] = useState<ViewMode>('search');
		const [configured, setConfigured] = useState(!!context.plugin.settings.apiKey);

		// Listen for settings changes (e.g., onboarding completes)
		useEffect(() => {
			return context.plugin.onSettingsChange(() => {
				setConfigured(!!context.plugin.settings.apiKey);
			});
		}, [context.plugin]);

		// Expose imperative handle for commands
		useImperativeHandle(ref, () => ({
			setMode: (mode: ViewMode) => setActiveMode(mode),
			focusSearch: () => {
				setActiveMode('search');
				// Focus the search input after React re-renders
				requestAnimationFrame(() => {
					const input = document.querySelector('.lumen-search-input') as HTMLInputElement;
					input?.focus();
				});
			},
		}), []);

		const handleModeChange = useCallback((mode: ViewMode) => {
			setActiveMode(mode);
		}, []);

		const showSyncStrip = !!context.plugin.syncManager;
		const needsUpgrade = context.planLoaded && !context.planFetchFailed && context.planTier === null;

		if (!configured) {
			return (
				<PluginProvider value={context}>
					<SidebarHeader />
					<OnboardingView />
				</PluginProvider>
			);
		}

		const syncStrip = showSyncStrip ? <SyncStatusStrip /> : undefined;

		return (
			<PluginProvider value={context}>
				<SidebarHeader syncStrip={syncStrip} />
				<TabBar activeMode={activeMode} onModeChange={handleModeChange} />
				<ConflictBanner />
				{activeMode === 'search' && (needsUpgrade ? <UpgradeRequiredView feature="search" /> : <SearchView />)}
				{activeMode === 'chat' && (needsUpgrade ? <UpgradeRequiredView feature="chat" /> : <ChatView />)}
				{activeMode === 'related' && <RelatedNotesView />}
			</PluginProvider>
		);
	},
);
