import type { PathTraversalView } from './campusDataView';
import type { RoutingStrategy } from './RoutingStrategy';

/**
 * Increment 1 routing mode (SDD 5.4): minimizes walking distance. Every path and entrance
 * is usable and stairs are used freely. Baseline for the other modes: their
 * totalDistanceM is never shorter than Shortest's for the same request.
 */
export class ShortestRouteStrategy implements RoutingStrategy {
	readonly mode = 'shortest' as const;

	/** RS-1: every path is usable. */
	isTraversable(): boolean {
		return true;
	}

	/** RS-1: every entrance is usable. */
	isEntranceUsable(): boolean {
		return true;
	}

	/** RS-2: cost equals distanceM. */
	edgeCost(traversal: PathTraversalView): number {
		return traversal.distanceM;
	}
}
