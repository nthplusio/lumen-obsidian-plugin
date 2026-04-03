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
	/** Incremented on retry to force children to re-mount */
	resetKey: number;
}

export class ErrorBoundary extends Component<Props, State> {
	state: State = { hasError: false, resetKey: 0 };

	static getDerivedStateFromError(): Partial<State> {
		return { hasError: true };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		logger.error(`React error boundary caught: ${error.message}`, info.componentStack ?? '');
	}

	private handleRetry = () => {
		this.setState(prev => ({ hasError: false, resetKey: prev.resetKey + 1 }));
	};

	render() {
		if (this.state.hasError) {
			return this.props.fallback ?? (
				<div className="lumen-error-boundary">
					<p>Something went wrong rendering this view.</p>
					<button onClick={this.handleRetry}>
						Try again
					</button>
				</div>
			);
		}
		return <div key={this.state.resetKey}>{this.props.children}</div>;
	}
}
