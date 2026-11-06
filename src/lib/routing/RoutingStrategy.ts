import type { RouteMode } from '../shared/types';
import type { EntranceView, PathTraversalView } from './campusDataView';

/**
 * Routing policy for one mode (SDD 5.3). Decides whether a path or entrance may be used and
 * what a usable path costs. Implemented by ShortestRouteStrategy, EasyRouteStrategy and
 * AdaRouteStrategy.
 *
 * Costs are in meter-equivalents so they compare directly with distance and keep the A*
 * heuristic valid. Implementations must be stateless and pure.
 */
export interface RoutingStrategy {
	/** The mode this strategy implements. RouteEngine registers strategies by this key. */
	readonly mode: RouteMode;

	/**
	 * RS-1 Determine Edge Traversability: may this path be travelled in this direction?
	 * Pre: traversal comes from CG-3. Post: same answer for the same input; never throws
	 * for null or unknown facts; nothing is mutated.
	 */
	isTraversable(traversal: PathTraversalView): boolean;

	/**
	 * RS-1 Determine Edge Traversability: may this entrance be a route endpoint?
	 * Pre: entrance comes from CD-4 or CG-4. Post: as for isTraversable.
	 */
	isEntranceUsable(entrance: EntranceView): boolean;

	/**
	 * RS-2 Evaluate Edge Cost: cost of travelling this path in its direction of travel.
	 * Pre: isTraversable(traversal) is true. Post: finite and >= traversal.distanceM; same
	 * result for the same input; nothing is mutated.
	 */
	edgeCost(traversal: PathTraversalView): number;
}

/** Grade for the direction of travel, or null when unknown or not a finite number. */
export function getKnownGrade(traversal: PathTraversalView): number | null {
	const g = traversal.gradePercent;
	return g !== null && Number.isFinite(g) ? g : null;
}
