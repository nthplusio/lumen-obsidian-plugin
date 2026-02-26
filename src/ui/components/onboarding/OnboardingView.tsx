/**
 * OnboardingView — Guided setup flow for new users.
 *
 * Shown when no API key is configured. Steps:
 *   1. Welcome — explain what Lumen does
 *   2. API Key Entry — paste key, validate format
 *   3. Connecting — auto-test connection
 *   4. Ready — show workspace name, trigger first sync
 *
 * The entire flow targets < 60 seconds from install to first search.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Notice, setIcon } from 'obsidian';
import { usePlugin } from '../../contexts/PluginContext';

type OnboardingStep = 'welcome' | 'api-key' | 'connecting' | 'ready';

interface ConnectionResult {
	workspaceName: string;
	chunkCount: number;
}

export function OnboardingView() {
	const [step, setStep] = useState<OnboardingStep>('welcome');
	const [apiKey, setApiKey] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [connectionResult, setConnectionResult] = useState<ConnectionResult | null>(null);
	const { plugin } = usePlugin();

	const handleStart = useCallback(() => {
		setStep('api-key');
	}, []);

	const handleConnect = useCallback(async () => {
		const trimmed = apiKey.trim();
		if (!trimmed) return;

		if (!trimmed.startsWith('vr_')) {
			setError('API keys start with "vr_". Check that you copied the full key.');
			return;
		}

		setError(null);
		setStep('connecting');

		// Save the key and update the client
		plugin.settings.apiKey = trimmed;
		await plugin.saveSettings();

		try {
			const status = await plugin.apiClient.testConnection();

			// Auto-resolve workspace ID
			if (status.workspace_id && !plugin.settings.workspaceId) {
				plugin.settings.workspaceId = status.workspace_id;
				await plugin.saveSettings();
			}

			// Initialize chat client if not already
			if (!plugin.chatClient && plugin.settings.workspaceId) {
				const { ChatClient } = await import('../../../chat-client');
				plugin.chatClient = new ChatClient(
					plugin.settings.apiKey,
					plugin.settings.workspaceId,
				);
			}

			setConnectionResult({
				workspaceName: 'your workspace',
				chunkCount: status.chunk_count ?? 0,
			});
			setStep('ready');
		} catch (err) {
			// Revert the key on failure
			plugin.settings.apiKey = '';
			await plugin.saveSettings();

			const msg = err instanceof Error ? err.message : 'Connection failed';
			if (msg.includes('401') || msg.includes('Unauthorized')) {
				setError('Invalid API key. Check that the key is correct and active.');
			} else if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED')) {
				setError('Could not reach the Lumen server. Please try again later.');
			} else {
				setError(msg);
			}
			setStep('api-key');
		}
	}, [apiKey, plugin]);

	const handleFinish = useCallback(async () => {
		// Trigger initial sync if configured
		if (plugin.syncManager) {
			plugin.syncManager.syncNow();
			new Notice('Syncing your vault...');
		} else {
			// Initialize sync components now that we have credentials
			await (plugin as any).initializeSync?.();
		}
	}, [plugin]);

	switch (step) {
		case 'welcome':
			return <WelcomeStep onStart={handleStart} />;
		case 'api-key':
			return (
				<ApiKeyStep
					apiKey={apiKey}
					onApiKeyChange={setApiKey}
					onConnect={handleConnect}
					error={error}
					onBack={() => setStep('welcome')}
				/>
			);
		case 'connecting':
			return <ConnectingStep />;
		case 'ready':
			return (
				<ReadyStep
					result={connectionResult!}
					onFinish={handleFinish}
				/>
			);
	}
}

// --- WelcomeStep ---

function WelcomeStep({ onStart }: { onStart: () => void }) {
	const iconRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLSpanElement>(null);
	const chatRef = useRef<HTMLSpanElement>(null);
	const syncRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, 'lumen-search');
		if (searchRef.current) setIcon(searchRef.current, 'search');
		if (chatRef.current) setIcon(chatRef.current, 'message-circle');
		if (syncRef.current) setIcon(syncRef.current, 'refresh-cw');
	}, []);

	return (
		<div className="lumen-onboarding">
			<div className="lumen-onboarding-logo" ref={iconRef} />
			<h2 className="lumen-onboarding-title">Welcome to Lumen</h2>
			<p className="lumen-onboarding-desc">
				AI-powered search and chat for your Obsidian vault.
			</p>
			<div className="lumen-onboarding-features">
				<div className="lumen-onboarding-feature">
					<span className="lumen-onboarding-feature-icon" ref={searchRef} />
					<span>Semantic search across all your notes</span>
				</div>
				<div className="lumen-onboarding-feature">
					<span className="lumen-onboarding-feature-icon" ref={chatRef} />
					<span>Chat with AI about your vault</span>
				</div>
				<div className="lumen-onboarding-feature">
					<span className="lumen-onboarding-feature-icon" ref={syncRef} />
					<span>Automatic vault sync and indexing</span>
				</div>
			</div>
			<button className="lumen-onboarding-cta" onClick={onStart}>
				Get Started
			</button>
			<p className="lumen-onboarding-hint">
				You'll need an API key from your Lumen dashboard.
			</p>
		</div>
	);
}

// --- ApiKeyStep ---

interface ApiKeyStepProps {
	apiKey: string;
	onApiKeyChange: (key: string) => void;
	onConnect: () => void;
	error: string | null;
	onBack: () => void;
}

function ApiKeyStep({ apiKey, onApiKeyChange, onConnect, error, onBack }: ApiKeyStepProps) {
	const keyRef = useRef<HTMLSpanElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const backRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (keyRef.current) setIcon(keyRef.current, 'key');
		if (backRef.current) setIcon(backRef.current, 'arrow-left');
		inputRef.current?.focus();
	}, []);

	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			onConnect();
		}
	}, [onConnect]);

	return (
		<div className="lumen-onboarding">
			<button className="lumen-onboarding-back" onClick={onBack}>
				<span ref={backRef} />
			</button>
			<div className="lumen-onboarding-step-icon">
				<span ref={keyRef} />
			</div>
			<h2 className="lumen-onboarding-title">Enter your API Key</h2>
			<p className="lumen-onboarding-desc">
				Paste your Lumen API key below. It starts with <code>vr_</code>.
			</p>
			<div className="lumen-onboarding-input-group">
				<input
					ref={inputRef}
					type="password"
					className="lumen-onboarding-input"
					placeholder="vr_..."
					value={apiKey}
					onChange={e => onApiKeyChange(e.target.value)}
					onKeyDown={handleKeyDown}
					autoComplete="off"
					spellCheck={false}
				/>
				<button
					className="lumen-onboarding-cta"
					onClick={onConnect}
					disabled={!apiKey.trim()}
				>
					Connect
				</button>
			</div>
			{error && (
				<div className="lumen-onboarding-error">
					{error}
				</div>
			)}
		</div>
	);
}

// --- ConnectingStep ---

function ConnectingStep() {
	const spinnerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (spinnerRef.current) setIcon(spinnerRef.current, 'loader');
	}, []);

	return (
		<div className="lumen-onboarding">
			<div className="lumen-onboarding-spinner" ref={spinnerRef} />
			<h2 className="lumen-onboarding-title">Connecting...</h2>
			<p className="lumen-onboarding-desc">
				Verifying your API key and setting up your workspace.
			</p>
		</div>
	);
}

// --- ReadyStep ---

function ReadyStep({ result, onFinish }: { result: ConnectionResult; onFinish: () => void }) {
	const checkRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (checkRef.current) setIcon(checkRef.current, 'check-circle');
	}, []);

	const hasNotes = result.chunkCount > 0;

	return (
		<div className="lumen-onboarding">
			<div className="lumen-onboarding-success-icon" ref={checkRef} />
			<h2 className="lumen-onboarding-title">You're all set!</h2>
			<p className="lumen-onboarding-desc">
				Connected to <strong>{result.workspaceName}</strong>
				{hasNotes
					? ` with ${result.chunkCount.toLocaleString()} chunks indexed.`
					: '. Your vault will be synced and indexed shortly.'}
			</p>
			<button className="lumen-onboarding-cta" onClick={onFinish}>
				{hasNotes ? 'Start Searching' : 'Sync & Start'}
			</button>
		</div>
	);
}
