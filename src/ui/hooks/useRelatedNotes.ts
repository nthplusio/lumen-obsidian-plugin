/**
 * useRelatedNotes — Related notes state management hook.
 *
 * Automatically fetches semantically similar notes when the active
 * file changes. Debounces requests and caches results per path.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { SearchResult } from '../../types';
import { classifyError, type ClassifiedError } from '../../utils/error-classifier';
import { usePlugin } from '../contexts/PluginContext';

const DEBOUNCE_MS = 500;
const RESULT_LIMIT = 15;

type RelatedStatus = 'idle' | 'loading' | 'done' | 'no-results' | 'no-file' | 'error' | 'not-configured';

interface RelatedState {
	activePath: string | null;
	activeFileName: string | null;
	results: SearchResult[];
	status: RelatedStatus;
	error: ClassifiedError | null;
}

type RelatedAction =
	| { type: 'SET_ACTIVE_FILE'; path: string | null; name: string | null }
	| { type: 'START_LOADING' }
	| { type: 'SET_RESULTS'; results: SearchResult[] }
	| { type: 'SET_NO_RESULTS' }
	| { type: 'SET_ERROR'; error: ClassifiedError }
	| { type: 'SET_NOT_CONFIGURED' };

const initialState: RelatedState = {
	activePath: null,
	activeFileName: null,
	results: [],
	status: 'idle',
	error: null,
};

function relatedReducer(state: RelatedState, action: RelatedAction): RelatedState {
	switch (action.type) {
		case 'SET_ACTIVE_FILE':
			return {
				...state,
				activePath: action.path,
				activeFileName: action.name,
				status: action.path ? state.status : 'no-file',
				results: action.path === state.activePath ? state.results : [],
			};
		case 'START_LOADING':
			return { ...state, status: 'loading', error: null };
		case 'SET_RESULTS':
			return { ...state, status: 'done', results: action.results };
		case 'SET_NO_RESULTS':
			return { ...state, status: 'no-results', results: [] };
		case 'SET_ERROR':
			return { ...state, status: 'error', error: action.error, results: [] };
		case 'SET_NOT_CONFIGURED':
			return { ...state, status: 'not-configured', results: [] };
	}
}

export interface UseRelatedNotesReturn {
	state: RelatedState;
	retry: () => void;
}

export function useRelatedNotes(): UseRelatedNotesReturn {
	const { plugin, app } = usePlugin();
	const [state, dispatch] = useReducer(relatedReducer, initialState);
	const debounceRef = useRef<ReturnType<typeof setTimeout>>();
	const cacheRef = useRef<Map<string, SearchResult[]>>(new Map());
	const activePathRef = useRef<string | null>(null);

	const fetchRelated = useCallback(async (path: string) => {
		if (!plugin.settings.apiKey) {
			dispatch({ type: 'SET_NOT_CONFIGURED' });
			return;
		}

		// Check cache first
		const cached = cacheRef.current.get(path);
		if (cached) {
			dispatch({ type: cached.length > 0 ? 'SET_RESULTS' : 'SET_NO_RESULTS', results: cached });
			return;
		}

		dispatch({ type: 'START_LOADING' });

		try {
			const results = await plugin.apiClient.searchSimilarDocuments(path, {
				limit: RESULT_LIMIT,
			});

			// Stale check — only update if this path is still active
			if (activePathRef.current !== path) return;

			// Cache results
			cacheRef.current.set(path, results);

			// Cap cache size
			if (cacheRef.current.size > 50) {
				const firstKey = cacheRef.current.keys().next().value as string;
				cacheRef.current.delete(firstKey);
			}

			if (results.length === 0) {
				dispatch({ type: 'SET_NO_RESULTS' });
			} else {
				dispatch({ type: 'SET_RESULTS', results });
			}
		} catch (err) {
			if (activePathRef.current !== path) return;
			const classified = classifyError(err);
			dispatch({ type: 'SET_ERROR', error: classified });
		}
	}, [plugin]);

	// Track active file changes
	useEffect(() => {
		const update = () => {
			const file = app.workspace.getActiveFile();
			const path = file?.extension === 'md' ? file.path : null;
			const name = path ? (file?.basename ?? path) : null;
			activePathRef.current = path;
			dispatch({ type: 'SET_ACTIVE_FILE', path, name });
		};
		update();
		const ref = app.workspace.on('active-leaf-change', update);
		return () => app.workspace.offref(ref);
	}, [app]);

	// Fetch related notes when active file changes (debounced)
	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current);

		if (!state.activePath) return;

		const path = state.activePath;
		debounceRef.current = setTimeout(() => {
			fetchRelated(path);
		}, DEBOUNCE_MS);

		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [state.activePath, fetchRelated]);

	const retry = useCallback(() => {
		if (state.activePath) {
			// Clear cache for this path to force re-fetch
			cacheRef.current.delete(state.activePath);
			fetchRelated(state.activePath);
		}
	}, [state.activePath, fetchRelated]);

	return { state, retry };
}
