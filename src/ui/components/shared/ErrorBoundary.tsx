/**
 * ErrorBoundary — Catches uncaught React errors to prevent the
 * entire view from going blank.
 *
 * React requires class components for error boundaries (no hook equivalent).
 */

import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { logger } from '../../../utils/logger';

interface Props {
	/** Fallback UI shown when an error is caught */
	fallback?: ReactNode;
	children: ReactNode;
}

interface State {
	hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
	state: State = { hasError: false };

	static getDerivedStateFromError(): State {
		return { hasError: true };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		logger.error(`React error boundary caught: ${error.message}`, info.componentStack ?? '');
	}

	render() {
		if (this.state.hasError) {
			return this.props.fallback ?? (
				<div className="lumen-error-boundary">
					<p>Something went wrong rendering this view.</p>
					<button onClick={() => this.setState({ hasError: false })}>
						Try again
					</button>
				</div>
			);
		}
		return this.props.children;
	}
}
