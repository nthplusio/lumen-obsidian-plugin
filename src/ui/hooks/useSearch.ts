/**
 * useSearch — Search state management hook.
 *
 * Encapsulates debounced search queries, tag filtering, hybrid mode,
 * retry logic with classified errors, and result state.
 */

import { useCallback, useEffect, useRef, useReducer } from 'react';
import type { SearchResult } from '../../types';
import { classifyError, type ClassifiedError } from '../../utils/error-classifier';
import { logger } from '../../utils/logger';
import { usePlugin } from '../contexts/PluginContext';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const DEBOUNCE_MS = 300;

type SearchStatus = 'idle' | 'typing' | 'loading' | 'retrying' | 'done' | 'error' | 'no-results' | 'not-configured';

interface SearchState {
	query: string;
	results: SearchResult[];
	status: SearchStatus;
	retryAttempt: number;
	error: ClassifiedError | null;
	hybridMode: boolean;
	selectedTags: string[];
	tagFilterOpen: boolean;
	tagCache: Array<{ tag: string; count: number }> | null;
}

type SearchAction =
	| { type: 'SET_QUERY'; query: string }
	| { type: 'SET_STATUS'; status: SearchStatus; retryAttempt?: number }
	| { type: 'SET_RESULTS'; results: SearchResult[] }
	| { type: 'SET_ERROR'; error: ClassifiedError }
	| { type: 'TOGGLE_HYBRID' }
	| { type: 'TOGGLE_TAG_FILTER' }
	| { type: 'SET_TAG_CACHE'; tags: Array<{ tag: string; count: number }> }
	| { type: 'ADD_TAG'; tag: string }
	| { type: 'REMOVE_TAG'; tag: string };

const initialState: SearchState = {
	query: '',
	results: [],
	status: 'idle',
	retryAttempt: 0,
	error: null,
	hybridMode: false,
	selectedTags: [],
	tagFilterOpen: false,
	tagCache: null,
};

function searchReducer(state: SearchState, action: SearchAction): SearchState {
	switch (action.type) {
		case 'SET_QUERY':
			return { ...state, query: action.query };
		case 'SET_STATUS':
			return { ...state, status: action.status, retryAttempt: action.retryAttempt ?? 0 };
		case 'SET_RESULTS':
			return { ...state, results: action.results, status: 'done', error: null };
		case 'SET_ERROR':
			return { ...state, error: action.error, status: 'error', results: [] };
		case 'TOGGLE_HYBRID':
			return { ...state, hybridMode: !state.hybridMode };
		case 'TOGGLE_TAG_FILTER':
			return { ...state, tagFilterOpen: !state.tagFilterOpen };
		case 'SET_TAG_CACHE':
			return { ...state, tagCache: action.tags };
		case 'ADD_TAG':
			if (state.selectedTags.includes(action.tag)) return state;
			return { ...state, selectedTags: [...state.selectedTags, action.tag] };
		case 'REMOVE_TAG':
			return { ...state, selectedTags: state.selectedTags.filter(t => t !== action.tag) };
	}
}

export interface UseSearchReturn {
	state: SearchState;
	onQueryChange: (query: string) => void;
	toggleHybrid: () => void;
	toggleTagFilter: () => void;
	addTag: (tag: string) => void;
	removeTag: (tag: string) => void;
	retry: () => void;
}

export function useSearch(): UseSearchReturn {
	const { plugin } = usePlugin();
	const [state, dispatch] = useReducer(searchReducer, initialState);
	const debounceRef = useRef<ReturnType<typeof setTimeout>>();
	const lastQueryRef = useRef('');

	const executeSearch = useCallback(async (query: string, retryCount = 0) => {
		if (!plugin.settings.apiKey) {
			dispatch({ type: 'SET_STATUS', status: 'not-configured' });
			return;
		}

		lastQueryRef.current = query;
		dispatch({ type: 'SET_STATUS', status: retryCount > 0 ? 'retrying' : 'loading', retryAttempt: retryCount });

		try {
			const results = await plugin.apiClient.semanticSearch(query, {
				limit: 20,
				hybrid: state.hybridMode || undefined,
				bm25_weight: state.hybridMode ? 0.3 : undefined,
				tags: state.selectedTags.length > 0 ? state.selectedTags : undefined,
			});

			// Check if superseded
			if (lastQueryRef.current !== query) return;

			if (!results || results.length === 0) {
				dispatch({ type: 'SET_STATUS', status: 'no-results' });
			} else {
				dispatch({ type: 'SET_RESULTS', results });
			}
		} catch (err) {
			if (lastQueryRef.current !== query) return;

			const classified = classifyError(err);

			if (classified.retryable && retryCount < MAX_RETRIES) {
				dispatch({ type: 'SET_STATUS', status: 'retrying', retryAttempt: retryCount + 1 });
				await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)));
				if (lastQueryRef.current === query) {
					await executeSearch(query, retryCount + 1);
				}
				return;
			}

			dispatch({ type: 'SET_ERROR', error: classified });
		}
	}, [plugin, state.hybridMode, state.selectedTags]);

	const onQueryChange = useCallback((query: string) => {
		dispatch({ type: 'SET_QUERY', query });

		if (debounceRef.current) clearTimeout(debounceRef.current);

		if (!query.trim()) {
			lastQueryRef.current = '';
			dispatch({ type: 'SET_STATUS', status: 'idle' });
			return;
		}

		dispatch({ type: 'SET_STATUS', status: 'typing' });
		debounceRef.current = setTimeout(() => {
			executeSearch(query.trim());
		}, DEBOUNCE_MS);
	}, [executeSearch]);

	const toggleHybrid = useCallback(() => {
		dispatch({ type: 'TOGGLE_HYBRID' });
	}, []);

	// Re-run search when hybrid mode or tags change
	useEffect(() => {
		if (state.query.trim()) {
			executeSearch(state.query.trim());
		}
	}, [state.hybridMode, state.selectedTags]);

	const toggleTagFilter = useCallback(() => {
		dispatch({ type: 'TOGGLE_TAG_FILTER' });
	}, []);

	// Fetch tags on first open
	useEffect(() => {
		if (state.tagFilterOpen && !state.tagCache) {
			(async () => {
				if (!plugin.settings.apiKey) return;
				try {
					const tags = await plugin.apiClient.listTags();
					dispatch({ type: 'SET_TAG_CACHE', tags });
					logger.debug(`Fetched ${tags.length} tags`);
				} catch (err) {
					logger.debug(`Failed to fetch tags: ${err instanceof Error ? err.message : String(err)}`);
					dispatch({ type: 'SET_TAG_CACHE', tags: [] });
				}
			})();
		}
	}, [state.tagFilterOpen, state.tagCache, plugin]);

	const addTag = useCallback((tag: string) => {
		dispatch({ type: 'ADD_TAG', tag });
	}, []);

	const removeTag = useCallback((tag: string) => {
		dispatch({ type: 'REMOVE_TAG', tag });
	}, []);

	const retry = useCallback(() => {
		if (state.query.trim()) {
			executeSearch(state.query.trim());
		}
	}, [state.query, executeSearch]);

	// Cleanup debounce on unmount
	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, []);

	return { state, onQueryChange, toggleHybrid, toggleTagFilter, addTag, removeTag, retry };
}
