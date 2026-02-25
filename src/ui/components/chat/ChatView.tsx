/**
 * ChatView — Full chat interface with SSE streaming, conversation management,
 * deep research toggle, markdown rendering, source chips, and rate limiting.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownRenderer, setIcon } from 'obsidian';
import type { ChatMessage, ChatSource, ConversationSummary } from '../../../types';
import { usePlugin } from '../../contexts/PluginContext';
import { useChat } from '../../hooks/useChat';
import { LoadingDots, SourceChips } from '../shared';

export function ChatView() {
	const chat = useChat();
	const { state } = chat;

	// Refresh plan gating when the view mounts
	useEffect(() => {
		chat.refreshPlanGating();
	}, []);

	return (
		<div className="lumen-chat-view">
			<ChatHeader
				conversationTitle={state.conversationTitle}
				conversationDropdownOpen={state.conversationDropdownOpen}
				onToggleDropdown={chat.toggleConversationDropdown}
				onNewChat={chat.startNewChat}
				onDelete={chat.deleteConversation}
			/>
			{state.conversationDropdownOpen && (
				<ConversationDropdown
					conversations={state.conversations}
					loading={state.conversationsLoading}
					activeId={state.conversationId}
					onSelect={chat.switchConversation}
				/>
			)}
			<ChatMessages
				messages={state.messages}
				streamContent={state.streamContent}
				isStreaming={state.status === 'streaming'}
				error={state.error}
				upgradeMessage={state.upgradeMessage}
				lastTurnsInfo={state.lastTurnsInfo}
				onSuggestionClick={chat.sendMessage}
			/>
			<ChatInputArea
				status={state.status}
				canDeepResearch={state.canDeepResearch}
				deepResearchEnabled={state.deepResearchEnabled}
				activeNoteContextEnabled={state.activeNoteContextEnabled}
				activeNotePath={state.activeNotePath}
				rateLimitResetsAt={state.rateLimitResetsAt}
				onSend={chat.sendMessage}
				onCancel={chat.cancelMessage}
				onToggleDeepResearch={chat.toggleDeepResearch}
				onToggleActiveNoteContext={chat.toggleActiveNoteContext}
				onDismissRateLimit={chat.dismissRateLimit}
			/>
		</div>
	);
}

// --- ChatHeader ---

interface ChatHeaderProps {
	conversationTitle: string | null;
	conversationDropdownOpen: boolean;
	onToggleDropdown: () => void;
	onNewChat: () => void;
	onDelete: () => Promise<void>;
}

function ChatHeader({ conversationTitle, onToggleDropdown, onNewChat, onDelete }: ChatHeaderProps) {
	const chevronRef = useRef<HTMLSpanElement>(null);
	const plusRef = useRef<HTMLButtonElement>(null);
	const trashRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (chevronRef.current) setIcon(chevronRef.current, 'chevron-down');
		if (plusRef.current) setIcon(plusRef.current, 'plus');
		if (trashRef.current) setIcon(trashRef.current, 'trash-2');
	}, []);

	return (
		<div className="lumen-chat-header">
			<div className="lumen-chat-header-title" onClick={onToggleDropdown}>
				<span className="lumen-chat-header-title-text">
					{conversationTitle ?? 'New Chat'}
				</span>
				<span className="lumen-chat-header-chevron" ref={chevronRef} />
			</div>
			<div className="lumen-chat-header-actions">
				<button
					className="lumen-chat-new-button"
					aria-label="New chat"
					ref={plusRef}
					onClick={onNewChat}
				/>
				<button
					className="lumen-chat-clear-btn"
					aria-label="Delete conversation"
					ref={trashRef}
					onClick={() => void onDelete()}
				/>
			</div>
		</div>
	);
}

// --- ConversationDropdown ---

interface ConversationDropdownProps {
	conversations: ConversationSummary[];
	loading: boolean;
	activeId: string | null;
	onSelect: (id: string, title: string | null) => void;
}

function ConversationDropdown({ conversations, loading, activeId, onSelect }: ConversationDropdownProps) {
	if (loading) {
		return (
			<div className="lumen-chat-conversation-dropdown">
				<div className="lumen-chat-conversation-loading">Loading...</div>
			</div>
		);
	}

	if (conversations.length === 0) {
		return (
			<div className="lumen-chat-conversation-dropdown">
				<div className="lumen-chat-conversation-empty">No conversations yet</div>
			</div>
		);
	}

	return (
		<div className="lumen-chat-conversation-dropdown">
			{conversations.map(conv => (
				<div
					key={conv.id}
					className={`lumen-chat-conversation-item ${conv.id === activeId ? 'is-active' : ''}`}
					onClick={() => onSelect(conv.id, conv.title)}
				>
					<div className="lumen-chat-conversation-item-title">
						{conv.title ?? 'Untitled'}
					</div>
					<div className="lumen-chat-conversation-item-date">
						{formatRelativeDate(new Date(conv.updatedAt))}
					</div>
				</div>
			))}
		</div>
	);
}

// --- ChatMessages ---

interface ChatMessagesProps {
	messages: ChatMessage[];
	streamContent: string;
	isStreaming: boolean;
	error: string | null;
	upgradeMessage: string | null;
	lastTurnsInfo: { turnsUsed: number; turnsRemaining: number } | null;
	onSuggestionClick: (prompt: string) => Promise<void>;
}

function ChatMessages({ messages, streamContent, isStreaming, error, upgradeMessage, lastTurnsInfo, onSuggestionClick }: ChatMessagesProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom on new messages or streaming
	useEffect(() => {
		if (containerRef.current) {
			containerRef.current.scrollTop = containerRef.current.scrollHeight;
		}
	}, [messages, streamContent]);

	const hasContent = messages.length > 0 || isStreaming || error || upgradeMessage;

	return (
		<div className="lumen-chat-messages" ref={containerRef}>
			{!hasContent && <ChatEmptyState onSuggestionClick={onSuggestionClick} />}
			{messages.map((msg, i) => {
				const isLast = i === messages.length - 1;
				return (
					<MessageBubble key={i} message={msg}>
						{isLast && msg.role === 'assistant' && lastTurnsInfo && (
							<TurnsInfoBadge
								turnsUsed={lastTurnsInfo.turnsUsed}
								turnsRemaining={lastTurnsInfo.turnsRemaining}
							/>
						)}
					</MessageBubble>
				);
			})}
			{isStreaming && <StreamingBubble content={streamContent} />}
			{error && <ErrorBubble message={error} />}
			{upgradeMessage && <UpgradeBubble message={upgradeMessage} />}
		</div>
	);
}

// --- ChatEmptyState ---

function ChatEmptyState({ onSuggestionClick }: { onSuggestionClick: (prompt: string) => Promise<void> }) {
	const iconRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, 'message-circle');
	}, []);

	const prompts = [
		'Summarize my recent meeting notes',
		'What are my open action items?',
		'Find connections between my research notes',
	];

	return (
		<div className="lumen-chat-empty-state">
			<div className="lumen-chat-empty-icon" ref={iconRef} />
			<p className="lumen-chat-empty-title">Ask questions about your vault</p>
			<p className="lumen-chat-empty-desc">Get AI-powered answers based on your notes</p>
			<div className="lumen-chat-suggestions">
				{prompts.map(prompt => (
					<button
						key={prompt}
						className="lumen-chat-suggestion"
						onClick={() => void onSuggestionClick(prompt)}
					>
						{prompt}
					</button>
				))}
			</div>
		</div>
	);
}

// --- MessageBubble ---

function MessageBubble({ message, children }: { message: ChatMessage; children?: React.ReactNode }) {
	return (
		<div className={`lumen-chat-message lumen-chat-message-${message.role}`}>
			<MessageHeader role={message.role} />
			<MessageContent message={message} />
			{message.sources && message.sources.length > 0 && (
				<div className="lumen-chat-sources">
					<span className="lumen-chat-sources-label">Sources:</span>
					<SourceChips sources={message.sources} />
				</div>
			)}
			{children}
		</div>
	);
}

function MessageHeader({ role }: { role: 'user' | 'assistant' }) {
	const iconRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, role === 'user' ? 'user' : 'bot');
	}, [role]);

	return (
		<div className="lumen-chat-message-header">
			<span className="lumen-chat-message-icon" ref={iconRef} />
			<span className="lumen-chat-message-role">{role === 'user' ? 'You' : 'Lumen'}</span>
		</div>
	);
}

function MessageContent({ message }: { message: ChatMessage }) {
	const { app, component } = usePlugin();
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!ref.current) return;
		ref.current.empty();

		if (message.role === 'assistant') {
			MarkdownRenderer.render(app, message.content, ref.current, '', component);
		} else {
			const p = document.createElement('p');
			p.textContent = message.content;
			ref.current.appendChild(p);
		}
	}, [message.content, message.role, app, component]);

	return <div className="lumen-chat-message-content" ref={ref} />;
}

// --- StreamingBubble ---

function StreamingBubble({ content }: { content: string }) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!ref.current) return;
		if (content) {
			ref.current.textContent = content;
		}
	}, [content]);

	return (
		<div className="lumen-chat-message lumen-chat-message-assistant">
			<MessageHeader role="assistant" />
			<div className="lumen-chat-message-content" ref={ref} />
			{!content && (
				<div className="lumen-chat-loading-inline">
					<LoadingDots />
				</div>
			)}
		</div>
	);
}

// --- ErrorBubble ---

function ErrorBubble({ message }: { message: string }) {
	const iconRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, 'alert-triangle');
	}, []);

	return (
		<div className="lumen-chat-message lumen-chat-message-error">
			<div className="lumen-chat-message-header">
				<span className="lumen-chat-message-icon lumen-chat-error-icon" ref={iconRef} />
				<span className="lumen-chat-message-role">Error</span>
			</div>
			<div className="lumen-chat-message-content">
				<p>{message}</p>
			</div>
		</div>
	);
}

// --- UpgradeBubble ---

function UpgradeBubble({ message }: { message: string }) {
	const iconRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, 'lock');
	}, []);

	return (
		<div className="lumen-chat-message lumen-chat-message-error">
			<div className="lumen-chat-message-header">
				<span className="lumen-chat-message-icon lumen-chat-error-icon" ref={iconRef} />
				<span className="lumen-chat-message-role">Upgrade Required</span>
			</div>
			<div className="lumen-chat-message-content">
				<p>{message}</p>
			</div>
		</div>
	);
}

// --- ChatInputArea ---

interface ChatInputAreaProps {
	status: 'idle' | 'sending' | 'streaming';
	canDeepResearch: boolean;
	deepResearchEnabled: boolean;
	activeNoteContextEnabled: boolean;
	activeNotePath: string | null;
	rateLimitResetsAt: string | null;
	onSend: (content: string) => Promise<void>;
	onCancel: () => void;
	onToggleDeepResearch: () => void;
	onToggleActiveNoteContext: () => void;
	onDismissRateLimit: () => void;
}

function ChatInputArea({
	status,
	canDeepResearch,
	deepResearchEnabled,
	activeNoteContextEnabled,
	activeNotePath,
	rateLimitResetsAt,
	onSend,
	onCancel,
	onToggleDeepResearch,
	onToggleActiveNoteContext,
	onDismissRateLimit,
}: ChatInputAreaProps) {
	const [input, setInput] = useState('');
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const sendIconRef = useRef<HTMLButtonElement>(null);
	const stopIconRef = useRef<HTMLButtonElement>(null);
	const sparklesRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (sendIconRef.current) setIcon(sendIconRef.current, 'send');
		if (stopIconRef.current) setIcon(stopIconRef.current, 'square');
		if (sparklesRef.current) setIcon(sparklesRef.current, 'sparkles');
	}, []);

	const handleSend = useCallback(() => {
		const msg = input.trim();
		if (!msg || status !== 'idle') return;
		setInput('');
		if (textareaRef.current) textareaRef.current.style.height = 'auto';
		void onSend(msg);
	}, [input, status, onSend]);

	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}, [handleSend]);

	const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setInput(e.target.value);
		if (textareaRef.current) {
			textareaRef.current.style.height = 'auto';
			textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
		}
	}, []);

	const noteIconRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (noteIconRef.current) setIcon(noteIconRef.current, 'file-text');
	}, []);

	const isBusy = status !== 'idle';
	const activeFileName = activeNotePath?.split('/').pop()?.replace(/\.md$/, '') ?? null;

	return (
		<div className="lumen-chat-input-area">
			{rateLimitResetsAt && (
				<RateLimitBanner resetsAt={rateLimitResetsAt} onDismiss={onDismissRateLimit} />
			)}
			{activeNoteContextEnabled && activeFileName && (
				<ActiveNoteBar fileName={activeFileName} onDisable={onToggleActiveNoteContext} />
			)}
			<div className="lumen-chat-input-row">
				<textarea
					ref={textareaRef}
					className="lumen-chat-input"
					placeholder="Ask about your vault..."
					rows={1}
					value={input}
					onChange={handleInput}
					onKeyDown={handleKeyDown}
				/>
				{activeNotePath && (
					<button
						className={`lumen-chat-note-context-toggle ${activeNoteContextEnabled ? 'is-active' : ''}`}
						aria-label={activeNoteContextEnabled ? `Context: ${activeFileName}` : 'Include active note as context'}
						aria-pressed={activeNoteContextEnabled}
						onClick={onToggleActiveNoteContext}
						ref={noteIconRef}
						title={activeNoteContextEnabled ? `Context: ${activeFileName}` : 'Include active note as context'}
					/>
				)}
				{canDeepResearch && (
					<button
						className={`lumen-chat-deep-research-toggle ${deepResearchEnabled ? 'is-active' : ''}`}
						aria-label="Toggle Deep Research"
						aria-pressed={deepResearchEnabled}
						onClick={onToggleDeepResearch}
						ref={sparklesRef}
					/>
				)}
				{!isBusy ? (
					<button
						className="lumen-chat-send-button"
						aria-label="Send message"
						ref={sendIconRef}
						onClick={handleSend}
					/>
				) : (
					<button
						className="lumen-chat-stop-button"
						aria-label="Stop generating"
						ref={stopIconRef}
						onClick={onCancel}
					/>
				)}
			</div>
		</div>
	);
}

// --- TurnsInfoBadge ---

function TurnsInfoBadge({ turnsUsed, turnsRemaining }: { turnsUsed: number; turnsRemaining: number }) {
	const iconRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, 'sparkles');
	}, []);

	return (
		<div className="lumen-chat-turns-info">
			<span className="lumen-chat-turns-icon" ref={iconRef} />
			<span>
				Deep Research &middot; {turnsUsed} turn{turnsUsed !== 1 ? 's' : ''} used &middot; {turnsRemaining} remaining
			</span>
		</div>
	);
}

// --- ActiveNoteBar ---

function ActiveNoteBar({ fileName, onDisable }: { fileName: string; onDisable: () => void }) {
	const fileRef = useRef<HTMLSpanElement>(null);
	const xRef2 = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (fileRef.current) setIcon(fileRef.current, 'file-text');
		if (xRef2.current) setIcon(xRef2.current, 'x');
	}, []);

	return (
		<div className="lumen-chat-note-context-bar">
			<span className="lumen-chat-note-context-icon" ref={fileRef} />
			<span className="lumen-chat-note-context-name">{fileName}</span>
			<button
				className="lumen-chat-note-context-dismiss"
				aria-label="Remove note context"
				ref={xRef2}
				onClick={onDisable}
			/>
		</div>
	);
}

// --- RateLimitBanner ---

function RateLimitBanner({ resetsAt, onDismiss }: { resetsAt: string; onDismiss: () => void }) {
	const alertRef = useRef<HTMLSpanElement>(null);
	const xRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (alertRef.current) setIcon(alertRef.current, 'alert-triangle');
		if (xRef.current) setIcon(xRef.current, 'x');
	}, []);

	let resetText = 'soon';
	if (resetsAt) {
		const resetDate = new Date(resetsAt);
		const diffMs = resetDate.getTime() - Date.now();
		if (diffMs > 0) {
			const diffMin = Math.ceil(diffMs / 60000);
			resetText = diffMin <= 1 ? 'in about a minute' : `in ~${diffMin} minutes`;
		}
	}

	return (
		<div className="lumen-chat-rate-limit-banner">
			<span className="lumen-chat-rate-limit-icon" ref={alertRef} />
			<span className="lumen-chat-rate-limit-text">
				Rate limit reached. Resets {resetText}.
			</span>
			<button
				className="lumen-chat-rate-limit-dismiss"
				aria-label="Dismiss"
				ref={xRef}
				onClick={onDismiss}
			/>
		</div>
	);
}

// --- Utility ---

function formatRelativeDate(date: Date): string {
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
