/**
 * LumenApp — Root component for the Lumen sidebar.
 *
 * Provides PluginContext and renders TabBar + the active view
 * (SearchView or ChatView). Only the active view is mounted.
 */

import { useState } from 'react';
import type { PluginContextValue } from './contexts/PluginContext';
import { PluginProvider } from './contexts/PluginContext';
import { TabBar, type ViewMode } from './components/TabBar';
import { SearchView } from './components/search/SearchView';
import { ChatView } from './components/chat/ChatView';

interface LumenAppProps {
	context: PluginContextValue;
}

export function LumenApp({ context }: LumenAppProps) {
	const [activeMode, setActiveMode] = useState<ViewMode>('search');

	return (
		<PluginProvider value={context}>
			<TabBar activeMode={activeMode} onModeChange={setActiveMode} />
			{activeMode === 'search' ? <SearchView /> : <ChatView />}
		</PluginProvider>
	);
}
