/**
 * LumenApp — Root component for the Lumen sidebar.
 *
 * Shows OnboardingView when no API key is configured.
 * Otherwise renders TabBar + the active view (SearchView or ChatView).
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
import { ConflictBanner } from './components/ConflictBanner';

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
					<OnboardingView />
				</PluginProvider>
			);
		}

		return (
			<PluginProvider value={context}>
				<ConflictBanner />
				<TabBar activeMode={activeMode} onModeChange={handleModeChange} />
				{activeMode === 'search' && <SearchView />}
				{activeMode === 'chat' && <ChatView />}
				{activeMode === 'related' && <RelatedNotesView />}
			</PluginProvider>
		);
	},
);
