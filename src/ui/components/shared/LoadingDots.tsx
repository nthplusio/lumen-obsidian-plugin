/**
 * LoadingDots — Animated dots indicator for chat streaming.
 * Uses CSS-only animation via the lumen-chat-pulse keyframes.
 */

export function LoadingDots() {
	return (
		<span className="lumen-loading-dots">
			<span className="lumen-dot" />
			<span className="lumen-dot" />
			<span className="lumen-dot" />
		</span>
	);
}
