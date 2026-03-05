/**
 * useChat — Chat state management hook.
 *
 * Encapsulates conversation management, SSE streaming with abort,
 * deep research toggle, rate limiting, and message state.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ActiveToolUse, ChatMessage, ChatSource, ConversationSummary, ThinkingState } from '../../types';
import { PlanUpgradeRequiredError, RateLimitExceededError } from '../../types';
import { logger } from '../../utils/logger';
import { usePlugin } from '../contexts/PluginContext';

type ChatStatus = 'idle' | 'sending' | 'streaming';

interface TurnsInfo {
	turnsUsed: number;
	turnsRemaining: number;
}

interface ChatState {
	messages: ChatMessage[];
	status: ChatStatus;
	conversationId: string | null;
	conversationTitle: string | null;
	deepResearchEnabled: boolean;
	/** Active note context — when enabled, includes the current note in chat messages */
	activeNoteContextEnabled: boolean;
	activeNotePath: string | null;
	streamContent: string;
	error: string | null;
	upgradeMessage: string | null;
	rateLimitResetsAt: string | null;
	conversationDropdownOpen: boolean;
	conversations: ConversationSummary[];
	conversationsLoading: boolean;
	/** Turns info from last deep research response */
	lastTurnsInfo: TurnsInfo | null;
	/** Active tool uses during streaming */
	activeTools: ActiveToolUse[];
	/** Current thinking state during streaming */
	thinking: ThinkingState | null;
}

type ChatAction =
	| { type: 'ADD_USER_MESSAGE'; content: string }
	| { type: 'START_STREAMING' }
	| { type: 'STREAM_TOKEN'; content: string }
	| { type: 'FINISH_STREAMING'; content: string; sources: ChatSource[]; turnsInfo?: TurnsInfo; tokenUsage?: { input: number; output: number } }
	| { type: 'STREAM_CANCELLED'; partialContent: string }
	| { type: 'SET_ERROR'; error: string }
	| { type: 'SET_UPGRADE_MESSAGE'; message: string }
	| { type: 'SET_RATE_LIMIT'; resetsAt: string }
	| { type: 'DISMISS_RATE_LIMIT' }
	| { type: 'SET_CONVERSATION'; id: string | null; title: string | null }
	| { type: 'NEW_CHAT' }
	| { type: 'TOGGLE_DEEP_RESEARCH' }
	| { type: 'SET_CONVERSATION_DROPDOWN'; open: boolean }
	| { type: 'SET_CONVERSATIONS'; conversations: ConversationSummary[]; loading: boolean }
	| { type: 'SET_CONVERSATIONS_LOADING' }
	| { type: 'TOGGLE_ACTIVE_NOTE_CONTEXT' }
	| { type: 'SET_ACTIVE_NOTE'; path: string | null }
	| { type: 'TOOL_START'; id: string; name: string }
	| { type: 'TOOL_COMPLETE'; id: string }
	| { type: 'SET_THINKING'; thinking: ThinkingState | null }
	| { type: 'SET_MESSAGES'; messages: ChatMessage[] };

const initialState: ChatState = {
	messages: [],
	status: 'idle',
	conversationId: null,
	conversationTitle: null,
	deepResearchEnabled: false,
	activeNoteContextEnabled: false,
	activeNotePath: null,
	streamContent: '',
	error: null,
	upgradeMessage: null,
	rateLimitResetsAt: null,
	conversationDropdownOpen: false,
	conversations: [],
	conversationsLoading: false,
	lastTurnsInfo: null,
	activeTools: [],
	thinking: null,
};

function chatReducer(state: ChatState, action: ChatAction): ChatState {
	switch (action.type) {
		case 'ADD_USER_MESSAGE':
			return {
				...state,
				messages: [...state.messages, { role: 'user', content: action.content }],
				error: null,
				upgradeMessage: null,
			};
		case 'START_STREAMING':
			return { ...state, status: 'streaming', streamContent: '', activeTools: [], thinking: null };
		case 'STREAM_TOKEN':
			return { ...state, streamContent: action.content };
		case 'FINISH_STREAMING': {
			const msg: ChatMessage = {
				role: 'assistant',
				content: action.content,
				sources: action.sources,
				tokenUsage: action.tokenUsage,
			};
			return {
				...state,
				status: 'idle',
				streamContent: '',
				messages: [...state.messages, msg],
				lastTurnsInfo: action.turnsInfo ?? null,
				activeTools: [],
				thinking: null,
			};
		}
		case 'STREAM_CANCELLED':
			return {
				...state,
				status: 'idle',
				streamContent: '',
				messages: action.partialContent
					? [...state.messages, { role: 'assistant', content: action.partialContent }]
					: state.messages,
				activeTools: [],
				thinking: null,
			};
		case 'SET_ERROR':
			return { ...state, status: 'idle', streamContent: '', error: action.error };
		case 'SET_UPGRADE_MESSAGE':
			return {
				...state,
				status: 'idle',
				streamContent: '',
				upgradeMessage: action.message,
				deepResearchEnabled: false,
			};
		case 'SET_RATE_LIMIT':
			return { ...state, rateLimitResetsAt: action.resetsAt };
		case 'DISMISS_RATE_LIMIT':
			return { ...state, rateLimitResetsAt: null };
		case 'SET_CONVERSATION':
			return {
				...state,
				conversationId: action.id,
				conversationTitle: action.title,
				messages: [],
				conversationDropdownOpen: false,
			};
		case 'NEW_CHAT':
			return {
				...state,
				conversationId: null,
				conversationTitle: null,
				messages: [],
				deepResearchEnabled: false,
				error: null,
				upgradeMessage: null,
				conversationDropdownOpen: false,
				lastTurnsInfo: null,
			};
		case 'TOGGLE_DEEP_RESEARCH':
			return { ...state, deepResearchEnabled: !state.deepResearchEnabled };
		case 'SET_CONVERSATION_DROPDOWN':
			return { ...state, conversationDropdownOpen: action.open };
		case 'SET_CONVERSATIONS':
			return { ...state, conversations: action.conversations, conversationsLoading: action.loading };
		case 'SET_CONVERSATIONS_LOADING':
			return { ...state, conversationsLoading: true };
		case 'TOGGLE_ACTIVE_NOTE_CONTEXT':
			return { ...state, activeNoteContextEnabled: !state.activeNoteContextEnabled };
		case 'SET_ACTIVE_NOTE':
			return { ...state, activeNotePath: action.path };
		case 'TOOL_START':
			return {
				...state,
				activeTools: [...state.activeTools, { id: action.id, name: action.name, status: 'running' }],
			};
		case 'TOOL_COMPLETE':
			return {
				...state,
				activeTools: state.activeTools.map(t =>
					t.id === action.id ? { ...t, status: 'complete' as const } : t,
				),
			};
		case 'SET_THINKING':
			return { ...state, thinking: action.thinking };
		case 'SET_MESSAGES':
			return { ...state, messages: action.messages };
	}
}

export interface UseChatReturn {
	state: ChatState;
	sendMessage: (content: string) => Promise<void>;
	cancelMessage: () => void;
	startNewChat: () => void;
	deleteConversation: () => Promise<void>;
	switchConversation: (id: string, title: string | null) => Promise<void>;
	toggleDeepResearch: () => void;
	toggleActiveNoteContext: () => void;
	toggleConversationDropdown: () => void;
	dismissRateLimit: () => void;
}

export function useChat(): UseChatReturn {
	const { plugin, app } = usePlugin();
	const [state, dispatch] = useReducer(chatReducer, initialState);
	const abortRef = useRef<AbortController | null>(null);
	// Use refs for values accessed in streaming callback to avoid stale closures
	const conversationIdRef = useRef<string | null>(null);
	const deepResearchRef = useRef(false);
	const activeNoteRef = useRef<{ enabled: boolean; path: string | null }>({ enabled: false, path: null });

	// Keep refs in sync with state
	conversationIdRef.current = state.conversationId;
	deepResearchRef.current = state.deepResearchEnabled;
	activeNoteRef.current = { enabled: state.activeNoteContextEnabled, path: state.activeNotePath };

	// Track active file changes
	useEffect(() => {
		const updateActiveNote = () => {
			const file = app.workspace.getActiveFile();
			dispatch({ type: 'SET_ACTIVE_NOTE', path: file?.path ?? null });
		};
		updateActiveNote();
		const ref = app.workspace.on('active-leaf-change', updateActiveNote);
		return () => app.workspace.offref(ref);
	}, [app]);

	const sendMessage = useCallback(async (content: string) => {
		const chatClient = plugin.chatClient;
		if (!chatClient || state.status !== 'idle') return;

		dispatch({ type: 'ADD_USER_MESSAGE', content });
		dispatch({ type: 'START_STREAMING' });

		abortRef.current = new AbortController();
		let streamedContent = '';
		let firstToken = true;

		// Build message with optional active note context
		let messageToSend = content;
		const noteCtx = activeNoteRef.current;
		if (noteCtx.enabled && noteCtx.path) {
			messageToSend = `[Context: active note is "${noteCtx.path}"]\n\n${content}`;
		}

		logger.info(`Chat: sending message (${content.length} chars, deep_research: ${deepResearchRef.current}, note_context: ${noteCtx.enabled ? noteCtx.path : 'off'})`);

		try {
			// Create conversation lazily
			let convId = conversationIdRef.current;
			if (!convId) {
				const conv = await chatClient.createConversation();
				convId = conv.id;
				dispatch({ type: 'SET_CONVERSATION', id: convId, title: null });
			}

			const response = await chatClient.sendMessage(convId, messageToSend, {
				deepResearch: deepResearchRef.current,
				signal: abortRef.current.signal,
				onToken: (token) => {
					if (firstToken) {
						firstToken = false;
						logger.debug('Chat: first token received');
					}
					streamedContent += token;
					dispatch({ type: 'STREAM_TOKEN', content: streamedContent });
				},
				onToolStart: (tool) => {
					logger.debug(`Chat: tool started — ${tool.name} (${tool.id})`);
					dispatch({ type: 'TOOL_START', id: tool.id, name: tool.name });
				},
				onToolComplete: (id) => {
					logger.debug(`Chat: tool completed — ${id}`);
					dispatch({ type: 'TOOL_COMPLETE', id });
				},
				onThinking: (type) => {
					dispatch({ type: 'SET_THINKING', thinking: { active: true, type: type as 'planning' | 'analyzing' | 'searching' | null } });
				},
			});

			logger.info(`Chat: complete (${response.content.length} chars, ${response.sources.length} sources)`);

			// Update conversation title from first message
			if (!conversationIdRef.current || (convId && !state.conversationTitle)) {
				const title = content.length > 40 ? content.slice(0, 40) + '...' : content;
				dispatch({ type: 'SET_CONVERSATION', id: convId, title });
			}

			dispatch({
				type: 'FINISH_STREAMING',
				content: response.content,
				sources: response.sources,
				turnsInfo: response.metadata && deepResearchRef.current
					? { turnsUsed: response.metadata.turnsUsed, turnsRemaining: response.metadata.turnsRemaining }
					: undefined,
				tokenUsage: response.metadata?.tokenUsage,
			});
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				dispatch({ type: 'STREAM_CANCELLED', partialContent: streamedContent });
				return;
			}

			if (err instanceof PlanUpgradeRequiredError) {
				dispatch({ type: 'SET_UPGRADE_MESSAGE', message: err.message });
			} else if (err instanceof RateLimitExceededError) {
				dispatch({ type: 'SET_RATE_LIMIT', resetsAt: err.resetsAt });
				dispatch({ type: 'SET_ERROR', error: err.message });
			} else {
				const errMsg = err instanceof Error ? err.message : 'An unexpected error occurred.';
				logger.error(`Chat failed: ${errMsg}`);
				dispatch({ type: 'SET_ERROR', error: errMsg });
			}
		} finally {
			abortRef.current = null;
		}
	}, [plugin, state.status, state.conversationTitle]);

	const cancelMessage = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
	}, []);

	const startNewChat = useCallback(() => {
		dispatch({ type: 'NEW_CHAT' });
	}, []);

	const deleteConversation = useCallback(async () => {
		if (state.conversationId && plugin.chatClient) {
			try {
				await plugin.chatClient.deleteConversation(state.conversationId);
			} catch {
				// Best effort
			}
		}
		dispatch({ type: 'NEW_CHAT' });
	}, [state.conversationId, plugin]);

	const switchConversation = useCallback(async (id: string, title: string | null) => {
		dispatch({ type: 'SET_CONVERSATION', id, title });

		// Load conversation messages from server
		const chatClient = plugin.chatClient;
		if (!chatClient) return;

		try {
			const conversation = await chatClient.getConversation(id);
			const messages: ChatMessage[] = conversation.messages
				.filter(msg => msg.role === 'user' || msg.role === 'assistant')
				.map(msg => ({
					role: msg.role as 'user' | 'assistant',
					content: msg.content ?? '',
					sources: msg.sources,
				}));
			dispatch({ type: 'SET_MESSAGES', messages });
			if (conversation.title) {
				dispatch({ type: 'SET_CONVERSATION', id, title: conversation.title });
			}
		} catch (err) {
			logger.warn(`Failed to load conversation messages: ${err instanceof Error ? err.message : String(err)}`);
		}
	}, [plugin]);

	const toggleDeepResearch = useCallback(() => {
		dispatch({ type: 'TOGGLE_DEEP_RESEARCH' });
	}, []);

	const toggleActiveNoteContext = useCallback(() => {
		dispatch({ type: 'TOGGLE_ACTIVE_NOTE_CONTEXT' });
	}, []);

	const toggleConversationDropdown = useCallback(async () => {
		const newOpen = !state.conversationDropdownOpen;
		dispatch({ type: 'SET_CONVERSATION_DROPDOWN', open: newOpen });

		if (newOpen && plugin.chatClient) {
			dispatch({ type: 'SET_CONVERSATIONS_LOADING' });
			try {
				const result = await plugin.chatClient.listConversations(20);
				dispatch({ type: 'SET_CONVERSATIONS', conversations: result.conversations, loading: false });
			} catch {
				dispatch({ type: 'SET_CONVERSATIONS', conversations: [], loading: false });
			}
		}
	}, [state.conversationDropdownOpen, plugin]);

	const dismissRateLimit = useCallback(() => {
		dispatch({ type: 'DISMISS_RATE_LIMIT' });
	}, []);

	return {
		state,
		sendMessage,
		cancelMessage,
		startNewChat,
		deleteConversation,
		switchConversation,
		toggleDeepResearch,
		toggleActiveNoteContext,
		toggleConversationDropdown,
		dismissRateLimit,
	};
}
