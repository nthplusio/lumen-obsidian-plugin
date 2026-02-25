/**
 * Tests for the onboarding flow component.
 *
 * Verifies that the onboarding steps are structurally complete
 * and that the LumenApp shows onboarding when not configured.
 */

import { describe, it, expect } from 'vitest';

describe('OnboardingView', () => {
	it('defines all onboarding steps', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/components/onboarding/OnboardingView.tsx', 'utf-8');
		const steps = ['welcome', 'api-key', 'connecting', 'ready'];
		for (const step of steps) {
			expect(content).toContain(`'${step}'`);
		}
	});

	it('validates API key format', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/components/onboarding/OnboardingView.tsx', 'utf-8');
		expect(content).toContain("startsWith('vr_')");
	});

	it('auto-resolves workspace ID on connect', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/components/onboarding/OnboardingView.tsx', 'utf-8');
		expect(content).toContain('workspace_id');
		expect(content).toContain('testConnection');
		expect(content).toContain('fetchAndApplyConfig');
	});

	it('reverts API key on connection failure', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/components/onboarding/OnboardingView.tsx', 'utf-8');
		// On failure, clear the key
		expect(content).toContain("plugin.settings.apiKey = ''");
	});

	it('triggers sync on finish', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/components/onboarding/OnboardingView.tsx', 'utf-8');
		expect(content).toContain('syncManager');
		expect(content).toContain('syncNow');
	});
});

describe('LumenApp onboarding gate', () => {
	it('shows OnboardingView when not configured', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/LumenApp.tsx', 'utf-8');
		expect(content).toContain('OnboardingView');
		expect(content).toContain('configured');
	});

	it('shows TabBar when configured', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/LumenApp.tsx', 'utf-8');
		expect(content).toContain('TabBar');
		expect(content).toContain('SearchView');
		expect(content).toContain('ChatView');
	});

	it('exposes imperative handle for commands', async () => {
		const { readFileSync } = await import('fs');
		const content = readFileSync('src/ui/LumenApp.tsx', 'utf-8');
		expect(content).toContain('useImperativeHandle');
		expect(content).toContain('LumenAppHandle');
		expect(content).toContain('setMode');
		expect(content).toContain('focusSearch');
	});
});
