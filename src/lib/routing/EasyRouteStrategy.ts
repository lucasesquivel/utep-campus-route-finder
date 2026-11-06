import { edgeHasStairs, type PathTraversalView } from './campusDataView';
import { getKnownGrade, type RoutingStrategy } from './RoutingStrategy';

/**
 * Increment 2 routing mode (SDD 5.5): prefers flatter, stair-free paths when a reasonable
 * alternative exists, without forbidding any path. Easy therefore finds a route whenever
 * Shortest does.
 *
 * Uphill costs more than downhill because Campus Data signs the grade per direction (CG-3).
 * Missing elevation adds no penalty: unknown facts are not guessed. The constants are
 * starting values to be tuned on real UTEP routes in Increment 2.
 */
export class EasyRouteStrategy implements RoutingStrategy {
	static readonly EASY_UPHILL_PER_PERCENT = 0.1;
	static readonly EASY_DOWNHILL_PER_PERCENT = 0.03;
	static readonly EASY_STAIRS_BASE_M = 25;
	static readonly EASY_STAIRS_PER_STEP_M = 1.5;
	static readonly EASY_DEFAULT_STEP_COUNT = 12;

	readonly mode = 'easy' as const;

	/** RS-1: every path is usable; Easy discourages through cost, never forbids. */
	isTraversable(): boolean {
		return true;
	}

	/** RS-1: every entrance is usable. */
	isEntranceUsable(): boolean {
		return true;
	}

	/** RS-2: distanceM x slopeFactor + stairPenalty. */
	edgeCost(traversal: PathTraversalView): number {
		return (
			traversal.distanceM * this.calculateSlopeFactor(traversal) +
			this.calculateStairPenalty(traversal)
		);
	}

	/** Direction-aware slope multiplier, always >= 1. */
	private calculateSlopeFactor(traversal: PathTraversalView): number {
		const grade = getKnownGrade(traversal);
		if (grade === null || grade === 0) return 1;
		return grade > 0
			? 1 + EasyRouteStrategy.EASY_UPHILL_PER_PERCENT * grade
			: 1 + EasyRouteStrategy.EASY_DOWNHILL_PER_PERCENT * -grade;
	}

	/** Additive stair penalty in meter-equivalents, always >= 0. */
	private calculateStairPenalty(traversal: PathTraversalView): number {
		if (!edgeHasStairs(traversal.edge)) return 0;
		const recorded = traversal.edge.stepCount;
		const steps =
			recorded !== null && Number.isFinite(recorded) && recorded >= 0
				? recorded
				: EasyRouteStrategy.EASY_DEFAULT_STEP_COUNT;
		return EasyRouteStrategy.EASY_STAIRS_BASE_M + EasyRouteStrategy.EASY_STAIRS_PER_STEP_M * steps;
	}
}
