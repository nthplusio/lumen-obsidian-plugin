/**
 * Main Sidebar View for Lumen.
 *
 * Provides a tabbed interface with Search and Chat modes.
 * Search: debounced semantic queries with results, tags, and hybrid mode.
 * Chat: conversational AI Q&A against the vault (stub backend for now).
 */

import { ItemView, MarkdownRenderer, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import type LumenPlugin from './main';
import type { ChatMessage, ChatSource, ConversationSummary, SearchResult } from './types';
import { PlanUpgradeRequiredError, RateLimitExceededError } from './types';
import { classifyError, type ClassifiedError } from './utils/error-classifier';
import { logger } from './utils/logger';

export const VIEW_TYPE_LUMEN_MAIN = 'lumen-main-view';

/** Maximum retry attempts for transient failures */
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

type ViewMode = 'search' | 'chat';

export class LumenMainView extends ItemView {
	private plugin: LumenPlugin;

	// Mode state
	private currentMode: ViewMode = 'search';
	private searchContainer: HTMLElement | null = null;
	private chatContainer: HTMLElement | null = null;

	// Search state
	private searchInput: HTMLInputElement | null = null;
	private resultsContainer: HTMLElement | null = null;
	private statusContainer: HTMLElement | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private lastQuery = '';
	private hybridMode = false;

	// Tags filter state
	private selectedTags: string[] = [];
	private tagCache: Array<{ tag: string; count: number }> | null = null;
	private tagFilterOpen = false;
	private tagFilterPanel: HTMLElement | null = null;
	private tagAutocompleteInput: HTMLInputElement | null = null;
	private tagDropdown: HTMLElement | null = null;
	private tagChipsContainer: HTMLElement | null = null;
	private tagDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	// Chat state
	private chatMessages: ChatMessage[] = [];
	private chatMessagesContainer: HTMLElement | null = null;
	private chatInput: HTMLTextAreaElement | null = null;
	private chatSendButton: HTMLElement | null = null;
	private chatStopButton: HTMLElement | null = null;
	private chatEmptyState: HTMLElement | null = null;
	private isChatSending = false;
	private chatCancelled = false;

	// Conversation state
	private conversationId: string | null = null;
	private conversationTitle: string | null = null;
	private conversationDropdownOpen = false;
	private conversationHeaderEl: HTMLElement | null = null;
	private conversationDropdownEl: HTMLElement | null = null;

	// Deep research state
	private deepResearchEnabled = false;
	private deepResearchToggle: HTMLElement | null = null;
	private canDeepResearch = false;

	// Rate limit state
	private rateLimitBanner: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: LumenPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_LUMEN_MAIN;
	}

	getDisplayText(): string {
		return 'Lumen';
	}

	getIcon(): string {
		return 'lumen-search';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		if (!container) return;
		container.empty();
		container.addClass('lumen-main-container');

		// Tab bar
		this.renderTabBar(container);

		// Search view
		this.searchContainer = container.createDiv({ cls: 'lumen-search-view' });
		this.renderSearchView(this.searchContainer);

		// Chat view (hidden initially)
		this.chatContainer = container.createDiv({ cls: 'lumen-chat-view lumen-view-hidden' });
		this.renderChatView(this.chatContainer);
	}

	async onClose(): Promise<void> {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		if (this.tagDebounceTimer) {
			clearTimeout(this.tagDebounceTimer);
		}
	}

	// -----------------------------------------------------------------------
	// Tab Bar
	// -----------------------------------------------------------------------

	private renderTabBar(container: HTMLElement): void {
		const tabBar = container.createDiv({ cls: 'lumen-tab-bar' });

		const searchTab = tabBar.createEl('button', {
			cls: 'lumen-tab lumen-tab-active',
			attr: { 'data-mode': 'search' },
		});
		const searchIcon = searchTab.createSpan({ cls: 'lumen-tab-icon' });
		setIcon(searchIcon, 'search');
		searchTab.createSpan({ text: 'Search', cls: 'lumen-tab-label' });

		const chatTab = tabBar.createEl('button', {
			cls: 'lumen-tab',
			attr: { 'data-mode': 'chat' },
		});
		const chatIcon = chatTab.createSpan({ cls: 'lumen-tab-icon' });
		setIcon(chatIcon, 'message-circle');
		chatTab.createSpan({ text: 'Chat', cls: 'lumen-tab-label' });

		searchTab.addEventListener('click', () => {
			this.switchToMode('search');
			searchTab.addClass('lumen-tab-active');
			chatTab.removeClass('lumen-tab-active');
		});

		chatTab.addEventListener('click', () => {
			this.switchToMode('chat');
			chatTab.addClass('lumen-tab-active');
			searchTab.removeClass('lumen-tab-active');
		});
	}

	/** Switch between search and chat modes */
	private switchToMode(mode: ViewMode): void {
		this.currentMode = mode;

		if (mode === 'search') {
			this.searchContainer?.removeClass('lumen-view-hidden');
			this.chatContainer?.addClass('lumen-view-hidden');
		} else {
			this.searchContainer?.addClass('lumen-view-hidden');
			this.chatContainer?.removeClass('lumen-view-hidden');
			// Refresh plan gating when switching to chat
			this.refreshPlanGating();
		}
	}

	/** Refresh plan info and update deep research toggle visibility */
	private async refreshPlanGating(): Promise<void> {
		const chatClient = this.plugin.chatClient;
		if (!chatClient) {
			this.canDeepResearch = false;
			this.updateDeepResearchVisibility();
			return;
		}

		try {
			const planInfo = await chatClient.getWorkspacePlan();
			this.canDeepResearch = planInfo.plan === 'plus' || planInfo.plan === 'pro';
		} catch {
			this.canDeepResearch = false;
		}
		this.updateDeepResearchVisibility();
	}

	/** Show/hide the deep research toggle based on plan */
	private updateDeepResearchVisibility(): void {
		if (!this.deepResearchToggle) return;
		if (this.canDeepResearch) {
			this.deepResearchToggle.removeClass('lumen-view-hidden');
		} else {
			this.deepResearchToggle.addClass('lumen-view-hidden');
			this.deepResearchEnabled = false;
			this.deepResearchToggle.removeClass('is-active');
			this.deepResearchToggle.setAttribute('aria-pressed', 'false');
		}
	}

	// -----------------------------------------------------------------------
	// Search View
	// -----------------------------------------------------------------------

	private renderSearchView(container: HTMLElement): void {
		// Search input area
		const searchArea = container.createDiv({ cls: 'lumen-search-area' });

		const inputWrapper = searchArea.createDiv({ cls: 'lumen-input-wrapper' });
		const iconEl = inputWrapper.createSpan({ cls: 'lumen-search-icon' });
		setIcon(iconEl, 'search');

		this.searchInput = inputWrapper.createEl('input', {
			type: 'text',
			placeholder: 'Search your vault...',
			cls: 'lumen-search-input',
		});

		this.searchInput.addEventListener('input', () => {
			this.onSearchInput();
		});

		this.searchInput.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				this.searchInput?.blur();
			}
		});

		// Search toolbar (hybrid toggle)
		const toolbar = searchArea.createDiv({ cls: 'lumen-search-toolbar' });
		const hybridBtn = toolbar.createEl('button', {
			cls: 'lumen-hybrid-toggle',
			attr: { 'aria-label': 'Toggle hybrid search', 'aria-pressed': 'false' },
		});
		setIcon(hybridBtn, 'zap');
		hybridBtn.createSpan({ text: 'Hybrid', cls: 'lumen-hybrid-label' });
		hybridBtn.addEventListener('click', () => {
			this.hybridMode = !this.hybridMode;
			hybridBtn.toggleClass('is-active', this.hybridMode);
			hybridBtn.setAttribute('aria-pressed', String(this.hybridMode));
			if (this.lastQuery) this.executeSearch(this.lastQuery);
		});

		// Tags filter toggle button
		const tagsBtn = toolbar.createEl('button', {
			cls: 'lumen-tags-toggle',
			attr: { 'aria-label': 'Filter by tags', 'aria-pressed': 'false' },
		});
		setIcon(tagsBtn, 'tag');
		tagsBtn.createSpan({ text: 'Tags', cls: 'lumen-tags-label' });
		tagsBtn.addEventListener('click', () => {
			this.toggleTagFilter(tagsBtn);
		});

		// Tags filter panel (collapsible, hidden by default)
		this.tagFilterPanel = searchArea.createDiv({ cls: 'lumen-tag-filter-panel lumen-tag-filter-collapsed' });

		// Tag chips for selected tags
		this.tagChipsContainer = this.tagFilterPanel.createDiv({ cls: 'lumen-tag-chips' });

		// Tag autocomplete input
		const tagInputWrapper = this.tagFilterPanel.createDiv({ cls: 'lumen-tag-input-wrapper' });
		this.tagAutocompleteInput = tagInputWrapper.createEl('input', {
			type: 'text',
			placeholder: 'Filter by tag...',
			cls: 'lumen-tag-autocomplete-input',
		});
		this.tagAutocompleteInput.addEventListener('input', () => {
			this.onTagInput();
		});
		this.tagAutocompleteInput.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				this.hideTagDropdown();
				this.tagAutocompleteInput?.blur();
			}
		});

		// Dropdown for autocomplete suggestions
		this.tagDropdown = tagInputWrapper.createDiv({ cls: 'lumen-tag-dropdown lumen-tag-dropdown-hidden' });

		// Status area (shows loading, result count, errors)
		this.statusContainer = container.createDiv({ cls: 'lumen-search-status' });

		// Results list
		this.resultsContainer = container.createDiv({ cls: 'lumen-results' });

		// Show initial empty state
		this.showEmptyState();
	}

	// -----------------------------------------------------------------------
	// Chat View
	// -----------------------------------------------------------------------

	private renderChatView(container: HTMLElement): void {
		// Header bar with conversation title and actions
		const header = container.createDiv({ cls: 'lumen-chat-header' });

		// Conversation title (clickable to open dropdown)
		this.conversationHeaderEl = header.createDiv({ cls: 'lumen-chat-header-title' });
		this.conversationHeaderEl.addEventListener('click', () => {
			this.toggleConversationDropdown();
		});
		this.updateConversationHeader();

		// Header actions
		const headerActions = header.createDiv({ cls: 'lumen-chat-header-actions' });

		// New Chat button
		const newChatBtn = headerActions.createEl('button', {
			cls: 'lumen-chat-new-button',
			attr: { 'aria-label': 'New chat' },
		});
		setIcon(newChatBtn, 'plus');
		newChatBtn.addEventListener('click', () => {
			this.startNewChat();
		});

		// Delete conversation button
		const deleteBtn = headerActions.createEl('button', {
			cls: 'lumen-chat-clear-btn',
			attr: { 'aria-label': 'Delete conversation' },
		});
		setIcon(deleteBtn, 'trash-2');
		deleteBtn.addEventListener('click', () => {
			this.deleteCurrentConversation();
		});

		// Conversation dropdown (hidden by default)
		this.conversationDropdownEl = container.createDiv({
			cls: 'lumen-chat-conversation-dropdown lumen-view-hidden',
		});

		// Messages area (scrollable)
		this.chatMessagesContainer = container.createDiv({ cls: 'lumen-chat-messages' });

		// Empty state
		this.chatEmptyState = this.chatMessagesContainer.createDiv({ cls: 'lumen-chat-empty-state' });
		this.showChatEmptyState();

		// Rate limit banner (hidden by default)
		const inputArea = container.createDiv({ cls: 'lumen-chat-input-area' });
		this.rateLimitBanner = inputArea.createDiv({
			cls: 'lumen-chat-rate-limit-banner lumen-view-hidden',
		});

		// Input row
		const inputRow = inputArea.createDiv({ cls: 'lumen-chat-input-row' });

		this.chatInput = inputRow.createEl('textarea', {
			cls: 'lumen-chat-input',
			attr: { placeholder: 'Ask about your vault...', rows: '1' },
		});

		this.chatInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendChatMessage();
			}
		});

		// Auto-resize textarea
		this.chatInput.addEventListener('input', () => {
			if (!this.chatInput) return;
			this.chatInput.style.height = 'auto';
			this.chatInput.style.height = Math.min(this.chatInput.scrollHeight, 120) + 'px';
		});

		// Deep research toggle
		this.deepResearchToggle = inputRow.createEl('button', {
			cls: 'lumen-chat-deep-research-toggle lumen-view-hidden',
			attr: { 'aria-label': 'Toggle Deep Research', 'aria-pressed': 'false' },
		});
		setIcon(this.deepResearchToggle, 'sparkles');
		this.deepResearchToggle.addEventListener('click', () => {
			this.deepResearchEnabled = !this.deepResearchEnabled;
			this.deepResearchToggle?.toggleClass('is-active', this.deepResearchEnabled);
			this.deepResearchToggle?.setAttribute('aria-pressed', String(this.deepResearchEnabled));
		});

		// Send button
		this.chatSendButton = inputRow.createEl('button', {
			cls: 'lumen-chat-send-button',
			attr: { 'aria-label': 'Send message' },
		});
		setIcon(this.chatSendButton, 'send');
		this.chatSendButton.addEventListener('click', () => {
			this.sendChatMessage();
		});

		// Stop button (hidden by default, shown during sending)
		this.chatStopButton = inputRow.createEl('button', {
			cls: 'lumen-chat-stop-button lumen-view-hidden',
			attr: { 'aria-label': 'Stop generating' },
		});
		setIcon(this.chatStopButton, 'square');
		this.chatStopButton.addEventListener('click', () => {
			this.cancelChat();
		});
	}

	// -----------------------------------------------------------------------
	// Conversation management
	// -----------------------------------------------------------------------

	/** Update the conversation header text */
	private updateConversationHeader(): void {
		if (!this.conversationHeaderEl) return;
		this.conversationHeaderEl.empty();

		const titleText = this.conversationTitle ?? 'New Chat';
		this.conversationHeaderEl.createSpan({ text: titleText, cls: 'lumen-chat-header-title-text' });

		const chevron = this.conversationHeaderEl.createSpan({ cls: 'lumen-chat-header-chevron' });
		setIcon(chevron, 'chevron-down');
	}

	/** Toggle the conversation list dropdown */
	private async toggleConversationDropdown(): Promise<void> {
		this.conversationDropdownOpen = !this.conversationDropdownOpen;

		if (!this.conversationDropdownEl) return;

		if (this.conversationDropdownOpen) {
			this.conversationDropdownEl.removeClass('lumen-view-hidden');
			await this.loadConversationList();
		} else {
			this.conversationDropdownEl.addClass('lumen-view-hidden');
		}
	}

	/** Load and render the conversation list in the dropdown */
	private async loadConversationList(): Promise<void> {
		if (!this.conversationDropdownEl || !this.plugin.chatClient) return;

		this.conversationDropdownEl.empty();
		this.conversationDropdownEl.createDiv({
			text: 'Loading...',
			cls: 'lumen-chat-conversation-loading',
		});

		try {
			const result = await this.plugin.chatClient.listConversations(20);
			this.conversationDropdownEl.empty();

			if (result.conversations.length === 0) {
				this.conversationDropdownEl.createDiv({
					text: 'No conversations yet',
					cls: 'lumen-chat-conversation-empty',
				});
				return;
			}

			for (const conv of result.conversations) {
				this.renderConversationItem(conv);
			}
		} catch {
			this.conversationDropdownEl.empty();
			this.conversationDropdownEl.createDiv({
				text: 'Failed to load conversations',
				cls: 'lumen-chat-conversation-error',
			});
		}
	}

	/** Render a single conversation item in the dropdown */
	private renderConversationItem(conv: ConversationSummary): void {
		if (!this.conversationDropdownEl) return;

		const item = this.conversationDropdownEl.createDiv({
			cls: 'lumen-chat-conversation-item',
		});

		if (conv.id === this.conversationId) {
			item.addClass('is-active');
		}

		item.createDiv({
			text: conv.title ?? 'Untitled',
			cls: 'lumen-chat-conversation-item-title',
		});

		const date = new Date(conv.updatedAt);
		item.createDiv({
			text: this.formatRelativeDate(date),
			cls: 'lumen-chat-conversation-item-date',
		});

		item.addEventListener('click', () => {
			this.switchToConversation(conv.id, conv.title);
		});
	}

	/** Switch to an existing conversation */
	private switchToConversation(id: string, title: string | null): void {
		this.conversationId = id;
		this.conversationTitle = title;
		this.chatMessages = [];
		this.updateConversationHeader();
		this.conversationDropdownOpen = false;
		this.conversationDropdownEl?.addClass('lumen-view-hidden');

		// Clear messages and show empty state
		if (this.chatMessagesContainer) {
			this.chatMessagesContainer.empty();
			this.chatEmptyState = this.chatMessagesContainer.createDiv({ cls: 'lumen-chat-empty-state' });
			this.showChatEmptyState();
		}
	}

	/** Start a new chat (clear conversation) */
	private startNewChat(): void {
		this.conversationId = null;
		this.conversationTitle = null;
		this.chatMessages = [];
		this.deepResearchEnabled = false;
		this.deepResearchToggle?.removeClass('is-active');
		this.deepResearchToggle?.setAttribute('aria-pressed', 'false');
		this.updateConversationHeader();
		this.conversationDropdownOpen = false;
		this.conversationDropdownEl?.addClass('lumen-view-hidden');

		if (this.chatMessagesContainer) {
			this.chatMessagesContainer.empty();
			this.chatEmptyState = this.chatMessagesContainer.createDiv({ cls: 'lumen-chat-empty-state' });
			this.showChatEmptyState();
		}
	}

	/** Delete the current conversation */
	private async deleteCurrentConversation(): Promise<void> {
		if (!this.conversationId || !this.plugin.chatClient) {
			this.startNewChat();
			return;
		}

		try {
			await this.plugin.chatClient.deleteConversation(this.conversationId);
		} catch {
			// Best effort — continue with local cleanup
		}

		this.startNewChat();
	}

	/** Format a date as a relative string (e.g., "2h ago", "Yesterday") */
	private formatRelativeDate(date: Date): string {
		const now = Date.now();
		const diffMs = now - date.getTime();
		const diffMin = Math.floor(diffMs / 60000);

		if (diffMin < 1) return 'Just now';
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHr = Math.floor(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h ago`;
		const diffDay = Math.floor(diffHr / 24);
		if (diffDay === 1) return 'Yesterday';
		if (diffDay < 7) return `${diffDay}d ago`;
		return date.toLocaleDateString();
	}

	/** Cancel ongoing chat request */
	private cancelChat(): void {
		this.chatCancelled = true;
	}

	private showChatEmptyState(): void {
		if (!this.chatEmptyState) return;
		this.chatEmptyState.empty();
		this.chatEmptyState.removeClass('lumen-view-hidden');

		const iconEl = this.chatEmptyState.createDiv({ cls: 'lumen-chat-empty-icon' });
		setIcon(iconEl, 'message-circle');

		this.chatEmptyState.createEl('p', {
			text: 'Ask questions about your vault',
			cls: 'lumen-chat-empty-title',
		});
		this.chatEmptyState.createEl('p', {
			text: 'Get AI-powered answers based on your notes',
			cls: 'lumen-chat-empty-desc',
		});

		// Suggested prompts
		const suggestions = this.chatEmptyState.createDiv({ cls: 'lumen-chat-suggestions' });

		const prompts = [
			'Summarize my recent meeting notes',
			'What are my open action items?',
			'Find connections between my research notes',
		];

		for (const prompt of prompts) {
			const btn = suggestions.createEl('button', {
				text: prompt,
				cls: 'lumen-chat-suggestion',
			});
			btn.addEventListener('click', () => {
				if (this.chatInput) {
					this.chatInput.value = prompt;
				}
				this.sendChatMessage();
			});
		}
	}

	/** Send a chat message via the conversations API with buffered SSE */
	private async sendChatMessage(): Promise<void> {
		const message = this.chatInput?.value.trim();
		if (!message || this.isChatSending) return;

		const chatClient = this.plugin.chatClient;

		if (!chatClient) {
			this.showChatError('Chat is not configured. Check your Lumen settings.');
			return;
		}

		// Hide empty state on first message
		this.chatEmptyState?.addClass('lumen-view-hidden');

		// Add user message to UI
		this.addChatMessage({ role: 'user', content: message });

		// Clear input
		if (this.chatInput) {
			this.chatInput.value = '';
			this.chatInput.style.height = 'auto';
		}

		// Create an empty assistant bubble with loading dots
		const { bubble, contentEl, loadingEl } = this.createAssistantBubble();

		// Show stop button, hide send button
		this.chatSendButton?.addClass('lumen-view-hidden');
		this.chatStopButton?.removeClass('lumen-view-hidden');

		this.isChatSending = true;
		this.chatCancelled = false;
		let firstToken = true;
		let streamedContent = '';
		let rafPending = false;

		logger.info(`Chat: sending message (${message.length} chars, deep_research: ${this.deepResearchEnabled})`);

		try {
			// Create conversation lazily if needed
			if (!this.conversationId) {
				const conv = await chatClient.createConversation();
				this.conversationId = conv.id;
			}

			const response = await chatClient.sendMessage(
				this.conversationId,
				message,
				{
					deepResearch: this.deepResearchEnabled,
					onToken: (token) => {
						if (this.chatCancelled) return;
						if (firstToken) {
							loadingEl.remove();
							firstToken = false;
							logger.debug('Chat: first token received');
						}
						streamedContent += token;
						// Batch DOM updates to one per animation frame
						if (!rafPending && typeof requestAnimationFrame === 'function') {
							rafPending = true;
							requestAnimationFrame(() => {
								rafPending = false;
								contentEl.textContent = streamedContent;
								if (this.chatMessagesContainer) {
									this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
								}
							});
						} else if (!rafPending) {
							contentEl.textContent = streamedContent;
						}
					},
				},
			);

			// Handle cancellation
			if (this.chatCancelled) {
				if (firstToken) loadingEl.remove();
				contentEl.empty();
				contentEl.createEl('p', {
					text: 'Message cancelled.',
					cls: 'lumen-chat-cancelled-text',
				});
				return;
			}

			// Remove loading dots if no tokens arrived
			if (firstToken) loadingEl.remove();

			logger.info(`Chat: complete (${response.content.length} chars, ${response.sources.length} sources)`);

			// Update conversation title from response if first message
			if (!this.conversationTitle && response.content.length > 0) {
				// Use first 40 chars of message as title hint
				this.conversationTitle = message.length > 40 ? message.slice(0, 40) + '...' : message;
				this.updateConversationHeader();
			}

			// Re-render with proper markdown formatting
			contentEl.empty();
			await MarkdownRenderer.render(this.app, response.content, contentEl, '', this);

			// Add source chips
			if (response.sources.length > 0) {
				this.renderChatSourcesWithScores(bubble, response.sources);
			}

			// Add turns info badge for deep research
			if (response.metadata && this.deepResearchEnabled) {
				this.renderTurnsInfo(bubble, response.metadata.turnsUsed, response.metadata.turnsRemaining);
			}

			// Push completed message to chat history
			this.chatMessages.push({
				role: 'assistant',
				content: response.content,
				sources: response.sources,
			});

			if (this.chatMessagesContainer) {
				this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
			}
		} catch (err) {
			if (firstToken) loadingEl.remove();
			bubble.remove();

			if (err instanceof PlanUpgradeRequiredError) {
				this.showChatUpgradePrompt(err.message);
				// Auto-disable deep research
				this.deepResearchEnabled = false;
				this.deepResearchToggle?.removeClass('is-active');
				this.deepResearchToggle?.setAttribute('aria-pressed', 'false');
			} else if (err instanceof RateLimitExceededError) {
				this.showRateLimitBanner(err.resetsAt);
				this.showChatError(err.message);
			} else {
				const errMsg = err instanceof Error ? err.message : 'An unexpected error occurred.';
				logger.error(`Chat failed: ${errMsg}`);
				this.showChatError(errMsg);
			}
		} finally {
			this.isChatSending = false;
			this.chatCancelled = false;
			// Restore send/stop button state
			this.chatSendButton?.removeClass('lumen-view-hidden');
			this.chatStopButton?.addClass('lumen-view-hidden');
		}
	}

	/** Create an empty assistant message bubble with loading dots for streaming */
	private createAssistantBubble(): { bubble: HTMLElement; contentEl: HTMLElement; loadingEl: HTMLElement } {
		if (!this.chatMessagesContainer) throw new Error('Chat container not initialized');

		const bubble = this.chatMessagesContainer.createDiv({
			cls: 'lumen-chat-message lumen-chat-message-assistant',
		});

		const header = bubble.createDiv({ cls: 'lumen-chat-message-header' });
		const roleIcon = header.createSpan({ cls: 'lumen-chat-message-icon' });
		setIcon(roleIcon, 'bot');
		header.createSpan({ text: 'Lumen', cls: 'lumen-chat-message-role' });

		const contentEl = bubble.createDiv({ cls: 'lumen-chat-message-content' });

		const loadingEl = bubble.createDiv({ cls: 'lumen-chat-loading-inline' });
		const dots = loadingEl.createDiv({ cls: 'lumen-chat-loading-dots' });
		dots.createSpan({ cls: 'lumen-chat-loading-dot' });
		dots.createSpan({ cls: 'lumen-chat-loading-dot' });
		dots.createSpan({ cls: 'lumen-chat-loading-dot' });

		this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
		return { bubble, contentEl, loadingEl };
	}

	/** Show upgrade prompt when chat requires a higher-tier plan */
	private showChatUpgradePrompt(message: string): void {
		if (!this.chatMessagesContainer) return;

		const bubble = this.chatMessagesContainer.createDiv({
			cls: 'lumen-chat-message lumen-chat-message-error',
		});

		const header = bubble.createDiv({ cls: 'lumen-chat-message-header' });
		const icon = header.createSpan({ cls: 'lumen-chat-message-icon lumen-chat-error-icon' });
		setIcon(icon, 'lock');
		header.createSpan({ text: 'Upgrade Required', cls: 'lumen-chat-message-role' });

		bubble.createDiv({ cls: 'lumen-chat-message-content' }).createEl('p', { text: message });

		this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
	}

	/** Clear all chat messages and reset to empty state (alias for startNewChat) */
	private clearChat(): void {
		this.startNewChat();
	}

	/** Add a message bubble to the chat */
	private addChatMessage(msg: ChatMessage): void {
		if (!this.chatMessagesContainer) return;

		this.chatMessages.push(msg);

		const bubble = this.chatMessagesContainer.createDiv({
			cls: `lumen-chat-message lumen-chat-message-${msg.role}`,
		});

		// Role label
		const header = bubble.createDiv({ cls: 'lumen-chat-message-header' });
		const roleIcon = header.createSpan({ cls: 'lumen-chat-message-icon' });
		setIcon(roleIcon, msg.role === 'user' ? 'user' : 'bot');
		header.createSpan({
			text: msg.role === 'user' ? 'You' : 'Lumen',
			cls: 'lumen-chat-message-role',
		});

		// Content
		const contentEl = bubble.createDiv({ cls: 'lumen-chat-message-content' });
		if (msg.role === 'assistant') {
			MarkdownRenderer.render(this.app, msg.content, contentEl, '', this);
		} else {
			contentEl.createEl('p', { text: msg.content });
		}

		// Sources (handle both string[] and ChatSource[])
		if (msg.sources && msg.sources.length > 0) {
			if (typeof msg.sources[0] === 'string') {
				this.renderChatSources(bubble, msg.sources as string[]);
			} else {
				this.renderChatSourcesWithScores(bubble, msg.sources as ChatSource[]);
			}
		}

		// Scroll to bottom
		this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
	}

	/** Render clickable source file chips below an assistant message (legacy string sources) */
	private renderChatSources(container: HTMLElement, sources: string[]): void {
		const sourcesEl = container.createDiv({ cls: 'lumen-chat-sources' });
		sourcesEl.createSpan({ text: 'Sources:', cls: 'lumen-chat-sources-label' });

		for (const source of sources) {
			const chip = sourcesEl.createEl('button', {
				cls: 'lumen-chat-source-chip',
			});
			const fileIcon = chip.createSpan({ cls: 'lumen-chat-source-icon' });
			setIcon(fileIcon, 'file-text');
			chip.createSpan({ text: this.filenameFromPath(source) });
			chip.addEventListener('click', () => {
				this.openDocument(source);
			});
		}
	}

	/** Render source chips with relevance scores (conversations API) */
	private renderChatSourcesWithScores(container: HTMLElement, sources: ChatSource[]): void {
		const sourcesEl = container.createDiv({ cls: 'lumen-chat-sources' });
		sourcesEl.createSpan({ text: 'Sources:', cls: 'lumen-chat-sources-label' });

		for (const source of sources) {
			const chip = sourcesEl.createEl('button', {
				cls: 'lumen-chat-source-chip',
			});
			const fileIcon = chip.createSpan({ cls: 'lumen-chat-source-icon' });
			setIcon(fileIcon, 'file-text');
			chip.createSpan({ text: this.filenameFromPath(source.path) });

			// Score badge
			const scorePercent = Math.round(source.score * 100);
			if (scorePercent > 0) {
				chip.createSpan({
					text: `${scorePercent}%`,
					cls: 'lumen-chat-source-score',
				});
			}

			chip.addEventListener('click', () => {
				this.openDocument(source.path);
			});
		}
	}

	/** Render a turns info badge for deep research responses */
	private renderTurnsInfo(container: HTMLElement, turnsUsed: number, turnsRemaining: number): void {
		const badge = container.createDiv({ cls: 'lumen-chat-turns-info' });
		const icon = badge.createSpan({ cls: 'lumen-chat-turns-icon' });
		setIcon(icon, 'sparkles');
		badge.createSpan({
			text: `Deep Research · ${turnsUsed} turn${turnsUsed !== 1 ? 's' : ''} used · ${turnsRemaining} remaining`,
		});
	}

	/** Show rate limit banner above the input */
	private showRateLimitBanner(resetsAt: string): void {
		if (!this.rateLimitBanner) return;

		this.rateLimitBanner.empty();
		this.rateLimitBanner.removeClass('lumen-view-hidden');

		const icon = this.rateLimitBanner.createSpan({ cls: 'lumen-chat-rate-limit-icon' });
		setIcon(icon, 'alert-triangle');

		let resetText = 'soon';
		if (resetsAt) {
			const resetDate = new Date(resetsAt);
			const diffMs = resetDate.getTime() - Date.now();
			if (diffMs > 0) {
				const diffMin = Math.ceil(diffMs / 60000);
				resetText = diffMin <= 1 ? 'in about a minute' : `in ~${diffMin} minutes`;
			}
		}

		this.rateLimitBanner.createSpan({
			text: `Rate limit reached. Resets ${resetText}.`,
			cls: 'lumen-chat-rate-limit-text',
		});

		const dismissBtn = this.rateLimitBanner.createEl('button', {
			cls: 'lumen-chat-rate-limit-dismiss',
			attr: { 'aria-label': 'Dismiss' },
		});
		setIcon(dismissBtn, 'x');
		dismissBtn.addEventListener('click', () => {
			this.rateLimitBanner?.addClass('lumen-view-hidden');
		});
	}

	/** Show a loading indicator in the chat */
	private showChatLoading(): HTMLElement | null {
		if (!this.chatMessagesContainer) return null;

		const loadingEl = this.chatMessagesContainer.createDiv({ cls: 'lumen-chat-loading' });
		const dots = loadingEl.createDiv({ cls: 'lumen-chat-loading-dots' });
		dots.createSpan({ cls: 'lumen-chat-loading-dot' });
		dots.createSpan({ cls: 'lumen-chat-loading-dot' });
		dots.createSpan({ cls: 'lumen-chat-loading-dot' });

		this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
		return loadingEl;
	}

	/** Display an error as an assistant message with warning */
	private showChatError(message: string): void {
		if (!this.chatMessagesContainer) return;

		const bubble = this.chatMessagesContainer.createDiv({
			cls: 'lumen-chat-message lumen-chat-message-error',
		});

		const header = bubble.createDiv({ cls: 'lumen-chat-message-header' });
		const warnIcon = header.createSpan({ cls: 'lumen-chat-message-icon lumen-chat-error-icon' });
		setIcon(warnIcon, 'alert-triangle');
		header.createSpan({ text: 'Error', cls: 'lumen-chat-message-role' });

		bubble.createDiv({ cls: 'lumen-chat-message-content' }).createEl('p', { text: message });

		this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
	}

	// -----------------------------------------------------------------------
	// Search Logic (unchanged from search-view.ts)
	// -----------------------------------------------------------------------

	/** Handle search input with debounce */
	private onSearchInput(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		const query = this.searchInput?.value.trim() ?? '';

		if (!query) {
			this.lastQuery = '';
			this.showEmptyState();
			return;
		}

		// Show typing indicator immediately
		this.showStatus('typing');

		// Debounce the actual search
		this.debounceTimer = setTimeout(() => {
			this.executeSearch(query);
		}, 300);
	}

	/** Execute the search against the MCP endpoint with retry logic */
	private async executeSearch(query: string, retryCount = 0): Promise<void> {
		// Check configuration
		if (!this.plugin.settings.apiKey) {
			this.showConfigError();
			return;
		}

		this.lastQuery = query;
		this.showStatus('loading');

		try {
			const results = await this.plugin.apiClient.semanticSearch(query, {
				limit: 20,
				hybrid: this.hybridMode || undefined,
				bm25_weight: this.hybridMode ? 0.3 : undefined,
				tags: this.selectedTags.length > 0 ? this.selectedTags : undefined,
			});

			// Check if this search was superseded by a newer query
			if (this.lastQuery !== query) {
				return;
			}

			if (!results || results.length === 0) {
				this.showNoResults(query);
			} else {
				this.renderResults(results, query);
			}
		} catch (err) {
			// Check if superseded
			if (this.lastQuery !== query) {
				return;
			}

			const classified = classifyError(err);

			// Auto-retry for transient errors
			if (classified.retryable && retryCount < MAX_RETRIES) {
				this.showStatus('retrying', retryCount + 1);
				await this.delay(RETRY_DELAY_MS * (retryCount + 1));
				// Re-check if still relevant
				if (this.lastQuery === query) {
					await this.executeSearch(query, retryCount + 1);
				}
				return;
			}

			this.showSearchError(classified, query);
		}
	}

	/** Render search results */
	private renderResults(results: SearchResult[], query: string): void {
		if (!this.resultsContainer || !this.statusContainer) return;

		// Status
		this.statusContainer.empty();
		this.statusContainer.createSpan({
			text: `${results.length} result${results.length === 1 ? '' : 's'}`,
			cls: 'lumen-result-count',
		});

		// Results
		this.resultsContainer.empty();

		for (const result of results) {
			const resultEl = this.resultsContainer.createDiv({ cls: 'lumen-result-item' });
			resultEl.addEventListener('click', () => {
				this.openDocument(result.source_path);
			});

			// Derive title from heading hierarchy or filename
			const title = result.heading_hierarchy?.[0]
				|| this.filenameFromPath(result.source_path);

			// Title row
			const titleRow = resultEl.createDiv({ cls: 'lumen-result-title-row' });

			const titleLeft = titleRow.createDiv({ cls: 'lumen-result-title-left' });
			const fileIcon = titleLeft.createSpan({ cls: 'lumen-result-file-icon' });
			setIcon(fileIcon, 'file-text');
			titleLeft.createSpan({
				text: title,
				cls: 'lumen-result-title',
			});

			// Score badge with color coding
			const scorePercent = Math.round(result.score * 100);
			const scoreCls = scorePercent >= 80 ? 'lumen-score-high'
				: scorePercent >= 50 ? 'lumen-score-medium'
				: 'lumen-score-low';
			titleRow.createSpan({
				text: `${scorePercent}%`,
				cls: `lumen-result-score ${scoreCls}`,
			});

			// Chunk count badge (when multiple sections matched)
			if (result.matching_chunks && result.matching_chunks > 1) {
				titleRow.createSpan({
					text: `${result.matching_chunks} sections`,
					cls: 'lumen-result-chunks',
				});
			}

			// Path (if different from title)
			const displayPath = this.stripWorkspacePrefix(result.source_path).replace(/\.md$/, '');
			if (displayPath !== title) {
				resultEl.createDiv({
					text: displayPath,
					cls: 'lumen-result-path',
				});
			}

			// Snippet — render as markdown for formatting
			if (result.content) {
				const snippetEl = resultEl.createDiv({ cls: 'lumen-result-snippet' });
				this.renderSnippet(snippetEl, result.content, query);
			}

			// Tags from frontmatter
			const tags = result.frontmatter?.tags as string[] | undefined;
			if (tags && tags.length > 0) {
				const tagsEl = resultEl.createDiv({ cls: 'lumen-result-tags' });
				for (const tag of tags.slice(0, 5)) {
					const tagEl = tagsEl.createSpan({ cls: 'lumen-tag' });
					setIcon(tagEl.createSpan({ cls: 'lumen-tag-icon' }), 'hash');
					tagEl.createSpan({ text: tag.replace(/^#/, '') });
				}
			}
		}
	}

	/** Render snippet with markdown support and query highlighting */
	private renderSnippet(el: HTMLElement, text: string, query: string): void {
		// Truncate to a reasonable snippet length
		const maxLen = 250;
		let snippet = text.replace(/\n{3,}/g, '\n\n').trim();
		if (snippet.length > maxLen) {
			snippet = snippet.slice(0, maxLen) + '...';
		}

		// Use Obsidian's MarkdownRenderer for rich formatting
		MarkdownRenderer.render(
			this.app,
			snippet,
			el,
			'',
			this,
		);

		// After rendering, highlight query terms in the rendered HTML
		this.highlightTermsInElement(el, query);
	}

	/** Walk DOM tree and highlight matching query terms in text nodes */
	private highlightTermsInElement(el: HTMLElement, query: string): void {
		const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
		if (terms.length === 0) return;

		const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
		const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');

		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		const textNodes: Text[] = [];
		let node: Text | null;
		while ((node = walker.nextNode() as Text | null)) {
			if (node.textContent && pattern.test(node.textContent)) {
				textNodes.push(node);
			}
			pattern.lastIndex = 0;
		}

		for (const textNode of textNodes) {
			const content = textNode.textContent || '';
			const fragment = document.createDocumentFragment();
			const parts = content.split(pattern);

			for (const part of parts) {
				pattern.lastIndex = 0;
				if (pattern.test(part)) {
					const mark = document.createElement('mark');
					mark.className = 'lumen-highlight';
					mark.textContent = part;
					fragment.appendChild(mark);
				} else {
					fragment.appendChild(document.createTextNode(part));
				}
				pattern.lastIndex = 0;
			}

			textNode.parentNode?.replaceChild(fragment, textNode);
		}
	}

	/** Open a document in Obsidian by its vault-relative path */
	private async openDocument(documentPath: string): Promise<void> {
		const normalizedPath = this.stripWorkspacePrefix(documentPath.replace(/^\/+/, ''));

		const file = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (file) {
			await this.app.workspace.openLinkText(normalizedPath, '', false);
		} else {
			// Try common path variations
			const withoutMd = normalizedPath.replace(/\.md$/, '');
			const withMd = normalizedPath.endsWith('.md') ? normalizedPath : normalizedPath + '.md';

			const altFile = this.app.vault.getAbstractFileByPath(withMd)
				|| this.app.vault.getAbstractFileByPath(withoutMd);

			if (altFile) {
				await this.app.workspace.openLinkText(altFile.path, '', false);
			} else {
				new Notice(`File not found in vault: ${normalizedPath}`);
			}
		}
	}

	/** Extract filename from a path */
	private filenameFromPath(path: string): string {
		return path.split('/').pop()?.replace(/\.md$/, '') ?? path;
	}

	/**
	 * Strip a leading workspace UUID prefix from a server-returned path.
	 *
	 * The server stores files under `{workspace_id}/path/to/file.md` but the
	 * Obsidian vault only has `path/to/file.md`. This detects the UUID prefix
	 * and removes it so the path resolves correctly in the vault.
	 */
	private stripWorkspacePrefix(path: string): string {
		return path.replace(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i,
			'',
		);
	}

	// --- Tags filter ---

	/** Toggle the tag filter panel open/closed */
	private async toggleTagFilter(btn: HTMLElement): Promise<void> {
		this.tagFilterOpen = !this.tagFilterOpen;
		btn.toggleClass('is-active', this.tagFilterOpen);
		btn.setAttribute('aria-pressed', String(this.tagFilterOpen));

		if (this.tagFilterPanel) {
			this.tagFilterPanel.toggleClass('lumen-tag-filter-collapsed', !this.tagFilterOpen);
		}

		// Fetch tags on first open
		if (this.tagFilterOpen && !this.tagCache) {
			await this.fetchTags();
		}
	}

	/** Fetch tags from the API and cache them */
	private async fetchTags(): Promise<void> {
		if (!this.plugin.settings.apiKey) return;

		try {
			this.tagCache = await this.plugin.apiClient.listTags();
			logger.debug(`Fetched ${this.tagCache.length} tags`);
		} catch (err) {
			logger.debug(`Failed to fetch tags: ${err instanceof Error ? err.message : String(err)}`);
			this.tagCache = [];
		}
	}

	/** Handle tag autocomplete input with debounce */
	private onTagInput(): void {
		if (this.tagDebounceTimer) {
			clearTimeout(this.tagDebounceTimer);
		}

		const query = this.tagAutocompleteInput?.value.trim().toLowerCase() ?? '';

		if (!query) {
			this.hideTagDropdown();
			return;
		}

		this.tagDebounceTimer = setTimeout(() => {
			this.showTagSuggestions(query);
		}, 300);
	}

	/** Show filtered tag suggestions in the dropdown */
	private showTagSuggestions(query: string): void {
		if (!this.tagDropdown || !this.tagCache) return;

		const filtered = this.tagCache
			.filter(t =>
				t.tag.toLowerCase().includes(query) &&
				!this.selectedTags.includes(t.tag),
			)
			.slice(0, 50);

		this.tagDropdown.empty();

		if (filtered.length === 0) {
			this.tagDropdown.addClass('lumen-tag-dropdown-hidden');
			return;
		}

		this.tagDropdown.removeClass('lumen-tag-dropdown-hidden');

		for (const item of filtered) {
			const row = this.tagDropdown.createDiv({ cls: 'lumen-tag-dropdown-item' });
			row.createSpan({ text: item.tag, cls: 'lumen-tag-dropdown-name' });
			row.createSpan({ text: `${item.count}`, cls: 'lumen-tag-dropdown-count' });
			row.addEventListener('click', () => {
				this.addTag(item.tag);
			});
		}
	}

	/** Hide the autocomplete dropdown */
	private hideTagDropdown(): void {
		this.tagDropdown?.addClass('lumen-tag-dropdown-hidden');
	}

	/** Add a tag to the selected set */
	private addTag(tag: string): void {
		if (this.selectedTags.includes(tag)) return;
		this.selectedTags.push(tag);
		this.renderTagChips();
		this.hideTagDropdown();
		if (this.tagAutocompleteInput) {
			this.tagAutocompleteInput.value = '';
		}
		// Re-run search with updated tags
		if (this.lastQuery) {
			this.executeSearch(this.lastQuery);
		}
	}

	/** Remove a tag from the selected set */
	private removeTag(tag: string): void {
		this.selectedTags = this.selectedTags.filter(t => t !== tag);
		this.renderTagChips();
		// Re-run search with updated tags
		if (this.lastQuery) {
			this.executeSearch(this.lastQuery);
		}
	}

	/** Render selected tag chips */
	private renderTagChips(): void {
		if (!this.tagChipsContainer) return;
		this.tagChipsContainer.empty();

		for (const tag of this.selectedTags) {
			const chip = this.tagChipsContainer.createSpan({ cls: 'lumen-tag-chip' });
			const iconEl = chip.createSpan({ cls: 'lumen-tag-chip-icon' });
			setIcon(iconEl, 'hash');
			chip.createSpan({ text: tag.replace(/^#/, ''), cls: 'lumen-tag-chip-text' });
			const removeBtn = chip.createSpan({ cls: 'lumen-tag-chip-remove', attr: { 'aria-label': `Remove ${tag}` } });
			setIcon(removeBtn, 'x');
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.removeTag(tag);
			});
		}
	}

	/** Promise-based delay helper */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	// --- State displays ---

	private showEmptyState(): void {
		if (!this.resultsContainer || !this.statusContainer) return;
		this.statusContainer.empty();
		this.resultsContainer.empty();

		const emptyEl = this.resultsContainer.createDiv({ cls: 'lumen-empty-state' });
		const iconEl = emptyEl.createDiv({ cls: 'lumen-empty-icon' });
		setIcon(iconEl, 'search');
		emptyEl.createEl('p', { text: 'Search your vault with natural language' });
		emptyEl.createEl('p', {
			text: 'Try: "notes about project planning" or "meeting with Sarah"',
			cls: 'lumen-empty-hint',
		});
	}

	private showNoResults(query: string): void {
		if (!this.resultsContainer || !this.statusContainer) return;
		this.statusContainer.empty();
		this.resultsContainer.empty();

		const emptyEl = this.resultsContainer.createDiv({ cls: 'lumen-empty-state' });
		const iconEl = emptyEl.createDiv({ cls: 'lumen-empty-icon' });
		setIcon(iconEl, 'search-x');
		emptyEl.createEl('p', { text: `No results for "${query}"` });
		emptyEl.createEl('p', {
			text: 'Try different keywords or a broader search',
			cls: 'lumen-empty-hint',
		});
	}

	private showStatus(state: 'loading' | 'typing' | 'retrying', attempt?: number): void {
		if (!this.statusContainer) return;
		this.statusContainer.empty();

		if (state === 'loading') {
			this.statusContainer.createSpan({
				text: 'Searching...',
				cls: 'lumen-searching',
			});
		} else if (state === 'retrying') {
			this.statusContainer.createSpan({
				text: `Retrying (attempt ${attempt ?? 1})...`,
				cls: 'lumen-searching',
			});
		}
	}

	private showSearchError(errorInfo: ClassifiedError, query: string): void {
		if (!this.resultsContainer || !this.statusContainer) return;
		this.statusContainer.empty();
		this.resultsContainer.empty();

		const errorEl = this.resultsContainer.createDiv({ cls: 'lumen-error-state' });

		// Icon
		const iconEl = errorEl.createDiv({ cls: 'lumen-error-icon' });
		setIcon(iconEl, errorInfo.category === 'auth' ? 'key' : 'alert-triangle');

		// Title
		const title = errorInfo.category === 'auth' ? 'Authentication Error'
			: errorInfo.category === 'network' ? 'Connection Error'
			: errorInfo.category === 'timeout' ? 'Connection Error'
			: errorInfo.category === 'rate-limit' ? 'Rate Limited'
			: 'Search Error';
		errorEl.createEl('p', { text: title, cls: 'lumen-error-title' });

		// Detail
		errorEl.createEl('p', { text: errorInfo.message, cls: 'lumen-error-detail' });

		// Action buttons container
		const actionsEl = errorEl.createDiv({ cls: 'lumen-error-actions' });

		// Retry button for retryable errors (after max retries exhausted)
		if (errorInfo.retryable) {
			const retryBtn = actionsEl.createEl('button', {
				text: 'Retry',
				cls: 'lumen-retry-button',
			});
			retryBtn.addEventListener('click', () => {
				this.executeSearch(query);
			});
		}

		// Settings link for auth/config errors
		if (errorInfo.category === 'auth' || errorInfo.category === 'config') {
			const settingsBtn = actionsEl.createEl('button', {
				text: 'Open Settings',
				cls: 'lumen-settings-link',
			});
			settingsBtn.addEventListener('click', () => {
				(this.app as any).setting?.open?.();
				(this.app as any).setting?.openTabById?.('lumen-search');
			});
		}

		// Test Connection button for network/server errors
		if (errorInfo.category === 'network' || errorInfo.category === 'server' || errorInfo.category === 'timeout') {
			const testBtn = actionsEl.createEl('button', {
				text: 'Test Connection',
				cls: 'lumen-test-button',
			});
			testBtn.addEventListener('click', async () => {
				try {
					const status = await this.plugin.apiClient.testConnection();
					new Notice(`Connected to Lumen v${status.version} (${status.status})`);
				} catch {
					new Notice('Connection failed. Server may be unreachable.');
				}
			});
		}
	}

	private showConfigError(): void {
		if (!this.resultsContainer || !this.statusContainer) return;
		this.statusContainer.empty();
		this.resultsContainer.empty();

		const errorEl = this.resultsContainer.createDiv({ cls: 'lumen-error-state' });
		const iconEl = errorEl.createDiv({ cls: 'lumen-error-icon' });
		setIcon(iconEl, 'settings');
		errorEl.createEl('p', { text: 'Not configured', cls: 'lumen-error-title' });
		errorEl.createEl('p', {
			text: 'Set your API URL and key to start searching.',
			cls: 'lumen-error-detail',
		});

		const settingsBtn = errorEl.createEl('button', {
			text: 'Open Settings',
			cls: 'lumen-settings-link',
		});
		settingsBtn.addEventListener('click', () => {
			(this.app as any).setting?.open?.();
			(this.app as any).setting?.openTabById?.('lumen-search');
		});
	}
}
