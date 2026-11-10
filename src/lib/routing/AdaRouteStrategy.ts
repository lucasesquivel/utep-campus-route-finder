import { edgeHasStairs, type EntranceView, type PathTraversalView } from './campusDataView';
import { getKnownGrade, type RoutingStrategy } from './RoutingStrategy';

/**
 * Increment 2 routing mode (SDD 5.6). Never uses stairs, paths marked inaccessible, slopes
 * steeper than the ADA ramp limit, or inaccessible / stepped entrances. Prefers paths
 * verified as accessible.
 *
 * Unknown-accessibility policy: OpenStreetMap rarely tags footways with wheelchair
 * information, so blocking every unknown path would leave most of campus unreachable.
 * Unknown paths and entrances stay usable, but unknown paths cost ADA_UNVERIFIED_FACTOR times
 * more, so a verified path wins when one exists. Route.unverifiedAccessibilityDistanceM
 * reports how much of the route is unverified so the UI can warn the user.
 *
 * KNOWN LIMITATION: an ADA route is NOT guaranteed to be accessible. It is guaranteed only
 * to avoid what Campus Data positively records as blocked (stairs, inaccessible paths and
 * entrances, steep grades). Wherever the data is silent, the route may pass through
 * something that is in fact inaccessible. The UI must show a warning whenever
 * route.unverifiedAccessibilityDistanceM > 0. An unknown entrance is also allowed and is
 * not counted in that distance, so the UI should check route.origin.entrance and
 * route.destination.entrance (accessibility.status === 'unknown') as well.
 *
 * Decision (SDD 5.6 design-review item): keep the permissive policy above and do not add a
 * strict option that blocks unknown paths. Revisit if the accessibility supplement leaves
 * few unknowns.
 */
export class AdaRouteStrategy implements RoutingStrategy {
	/** 1:12 ADA ramp limit, in percent. */
	static readonly ADA_MAX_GRADE_PERCENT = 8.33;
	static readonly ADA_UPHILL_PER_PERCENT = 0.1;
	static readonly ADA_UNVERIFIED_FACTOR = 1.5;

	readonly mode = 'ada' as const;

	/**
	 * RS-1: not traversable if the edge has stairs or is kind 'steps', is marked
	 * inaccessible, or has a known grade steeper than ADA_MAX_GRADE_PERCENT in either direction.
	 */
	isTraversable(traversal: PathTraversalView): boolean {
		const edge = traversal.edge;
		if (edgeHasStairs(edge)) return false;
		if (edge.accessibility.status === 'inaccessible') return false;
		const grade = getKnownGrade(traversal);
		return grade === null || Math.abs(grade) <= AdaRouteStrategy.ADA_MAX_GRADE_PERCENT;
	}

	/** RS-1: not usable if the entrance is marked inaccessible or has steps. */
	isEntranceUsable(entrance: EntranceView): boolean {
		return entrance.accessibility.status !== 'inaccessible' && entrance.hasSteps !== true;
	}

	/**
	 * RS-2: distanceM x (1 + ADA_UPHILL_PER_PERCENT x max(grade, 0)) x unverified factor.
	 * A null grade adds no slope factor.
	 */
	edgeCost(traversal: PathTraversalView): number {
		const grade = getKnownGrade(traversal) ?? 0;
		const slopeFactor = 1 + AdaRouteStrategy.ADA_UPHILL_PER_PERCENT * Math.max(grade, 0);
		const unverifiedFactor =
			traversal.edge.accessibility.status === 'unknown'
				? AdaRouteStrategy.ADA_UNVERIFIED_FACTOR
				: 1;
		return traversal.distanceM * slopeFactor * unverifiedFactor;
	}
}
