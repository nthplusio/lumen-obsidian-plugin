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
import { PluginProvider, usePlugin } from './contexts/PluginContext';
import { usePlanState } from './hooks/usePlanState';
import { TabBar, type ViewMode } from './components/TabBar';
import { SearchView } from './components/search/SearchView';
import { ChatView } from './components/chat/ChatView';
import { RelatedNotesView } from './components/related/RelatedNotesView';
import { OnboardingView } from './components/onboarding/OnboardingView';
import { UpgradeRequiredView } from './components/UpgradeRequiredView';
import { ConflictBanner } from './components/ConflictBanner';
import { SidebarHeader } from './components/SidebarHeader';
import { SyncStatusStrip } from './components/SyncStatusStrip';
import { ErrorBoundary } from './components/shared';

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

		if (!configured) {
			return (
				<PluginProvider value={context}>
					<SidebarHeader />
					<OnboardingView />
				</PluginProvider>
			);
		}

		return (
			<PluginProvider value={context}>
				<ErrorBoundary>
					<LumenAppContent activeMode={activeMode} onModeChange={handleModeChange} />
				</ErrorBoundary>
			</PluginProvider>
		);
	},
);

/**
 * Inner content rendered inside PluginProvider so hooks like
 * usePlanState (which calls usePlugin) have access to context.
 */
function LumenAppContent({
	activeMode,
	onModeChange,
}: {
	activeMode: ViewMode;
	onModeChange: (mode: ViewMode) => void;
}) {
	const { plugin } = usePlugin();
	const { planTier, planLoaded, planFetchFailed } = usePlanState();

	const showSyncStrip = !!plugin.syncManager;
	const chatNeedsUpgrade = planLoaded && !planFetchFailed && planTier === null;
	const syncStrip = showSyncStrip ? <SyncStatusStrip /> : undefined;

	return (
		<>
			<SidebarHeader syncStrip={syncStrip} />
			<TabBar activeMode={activeMode} onModeChange={onModeChange} />
			<ConflictBanner />
			{activeMode === 'search' && <SearchView />}
			{activeMode === 'chat' && (chatNeedsUpgrade ? <UpgradeRequiredView feature="chat" /> : <ChatView />)}
			{activeMode === 'related' && <RelatedNotesView />}
		</>
	);
}
