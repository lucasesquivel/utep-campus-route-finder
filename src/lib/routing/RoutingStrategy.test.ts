import { describe, expect, it } from 'vitest';
import { AdaRouteStrategy } from './AdaRouteStrategy';
import { EasyRouteStrategy } from './EasyRouteStrategy';
import type { RoutingStrategy } from './RoutingStrategy';
import { ShortestRouteStrategy } from './ShortestRouteStrategy';
import { entrance, traversal } from './testFixtures';

const ALL: RoutingStrategy[] = [
	new ShortestRouteStrategy(),
	new EasyRouteStrategy(),
	new AdaRouteStrategy()
];

describe('RoutingStrategy contract (RS-1, RS-2) for every strategy', () => {
	const samples = [
		traversal(),
		traversal({ gradePercent: 5 }),
		traversal({ gradePercent: -5 }),
		traversal({ gradePercent: 8.33 }),
		traversal({ gradePercent: null }),
		traversal({ accessibility: 'unknown' }),
		traversal({ accessibility: 'unknown', gradePercent: 3 }),
		traversal({ hasStairs: true, stepCount: 20 }),
		traversal({ kind: 'steps', hasStairs: null }),
		traversal({ hasStairs: true, stepCount: null }),
		traversal({ distanceM: 0.5, gradePercent: 2 }),
		traversal({ gradePercent: Number.NaN })
	];

	for (const strategy of ALL) {
		describe(strategy.mode, () => {
			it('RS-2: cost is finite and >= distanceM for every traversable sample', () => {
				for (const t of samples) {
					if (!strategy.isTraversable(t)) continue;
					const c = strategy.edgeCost(t);
					expect(Number.isFinite(c)).toBe(true);
					expect(c).toBeGreaterThanOrEqual(t.distanceM);
				}
			});

			it('is pure: same input gives the same answer and nothing is mutated', () => {
				for (const t of samples) {
					const snapshot = JSON.stringify(t);
					expect(strategy.isTraversable(t)).toBe(strategy.isTraversable(t));
					if (strategy.isTraversable(t)) {
						expect(strategy.edgeCost(t)).toBe(strategy.edgeCost(t));
					}
					expect(JSON.stringify(t)).toBe(snapshot);
				}
			});

			it('RS-1: never throws for null or unknown facts', () => {
				const unknown = traversal({
					gradePercent: null,
					elevationChangeM: null,
					hasStairs: null,
					stepCount: null,
					accessibility: 'unknown'
				});
				expect(() => strategy.isTraversable(unknown)).not.toThrow();
				expect(() =>
					strategy.isEntranceUsable(
						entrance('x', 'n', { hasSteps: null, accessibility: 'unknown' })
					)
				).not.toThrow();
			});
		});
	}
});

describe('ShortestRouteStrategy', () => {
	const s: RoutingStrategy = new ShortestRouteStrategy();

	it("has mode 'shortest'", () => {
		expect(s.mode).toBe('shortest');
	});

	it('allows every path and entrance, including stairs and inaccessible ones', () => {
		expect(s.isTraversable(traversal({ hasStairs: true, kind: 'steps' }))).toBe(true);
		expect(s.isTraversable(traversal({ accessibility: 'inaccessible', gradePercent: 30 }))).toBe(
			true
		);
		expect(
			s.isEntranceUsable(entrance('e', 'n', { hasSteps: true, accessibility: 'inaccessible' }))
		).toBe(true);
	});

	it('costs exactly distanceM regardless of slope or stairs', () => {
		expect(s.edgeCost(traversal({ distanceM: 40 }))).toBe(40);
		expect(s.edgeCost(traversal({ distanceM: 40, gradePercent: 12, hasStairs: true }))).toBe(40);
	});
});

describe('EasyRouteStrategy', () => {
	const s: RoutingStrategy = new EasyRouteStrategy();

	it("has mode 'easy' and the SDD 5.5 constants", () => {
		expect(s.mode).toBe('easy');
		expect(EasyRouteStrategy.EASY_UPHILL_PER_PERCENT).toBe(0.1);
		expect(EasyRouteStrategy.EASY_DOWNHILL_PER_PERCENT).toBe(0.03);
		expect(EasyRouteStrategy.EASY_STAIRS_BASE_M).toBe(25);
		expect(EasyRouteStrategy.EASY_STAIRS_PER_STEP_M).toBe(1.5);
		expect(EasyRouteStrategy.EASY_DEFAULT_STEP_COUNT).toBe(12);
	});

	it('never forbids a path or entrance', () => {
		expect(s.isTraversable(traversal({ hasStairs: true, accessibility: 'inaccessible' }))).toBe(
			true
		);
		expect(s.isEntranceUsable(entrance('e', 'n', { hasSteps: true }))).toBe(true);
	});

	it('matches the SDD 5.5 worked examples', () => {
		// 40 m path at +6% costs 40 x 1.6 = 64.
		expect(s.edgeCost(traversal({ distanceM: 40, gradePercent: 6 }))).toBeCloseTo(64, 10);
		// The same path downhill costs 40 x 1.18 = 47.2.
		expect(s.edgeCost(traversal({ distanceM: 40, gradePercent: -6 }))).toBeCloseTo(47.2, 10);
		// A flight of 20 steps adds 25 + 30 = 55.
		expect(s.edgeCost(traversal({ distanceM: 10, hasStairs: true, stepCount: 20 }))).toBeCloseTo(
			10 + 55,
			10
		);
	});

	it('uses EASY_DEFAULT_STEP_COUNT when stepCount is unknown', () => {
		expect(s.edgeCost(traversal({ distanceM: 10, hasStairs: true, stepCount: null }))).toBeCloseTo(
			10 + 25 + 1.5 * 12,
			10
		);
	});

	it("treats kind 'steps' as stairs even when hasStairs is null", () => {
		expect(s.edgeCost(traversal({ distanceM: 10, kind: 'steps', hasStairs: null }))).toBeCloseTo(
			10 + 25 + 1.5 * 12,
			10
		);
	});

	it('adds no penalty for missing elevation (unknown facts are not guessed)', () => {
		expect(s.edgeCost(traversal({ distanceM: 40, gradePercent: null }))).toBe(40);
	});

	it('costs uphill more than downhill for the same path', () => {
		const up = s.edgeCost(traversal({ gradePercent: 4 }));
		const down = s.edgeCost(traversal({ gradePercent: -4 }));
		expect(up).toBeGreaterThan(down);
		expect(down).toBeGreaterThan(40);
	});
});

describe('AdaRouteStrategy', () => {
	const s: RoutingStrategy = new AdaRouteStrategy();

	it("has mode 'ada' and the SDD 5.6 constants", () => {
		expect(s.mode).toBe('ada');
		expect(AdaRouteStrategy.ADA_MAX_GRADE_PERCENT).toBe(8.33);
		expect(AdaRouteStrategy.ADA_UPHILL_PER_PERCENT).toBe(0.1);
		expect(AdaRouteStrategy.ADA_UNVERIFIED_FACTOR).toBe(1.5);
	});

	describe('RS-1 paths', () => {
		it('blocks stairs (hasStairs or kind steps)', () => {
			expect(s.isTraversable(traversal({ hasStairs: true }))).toBe(false);
			expect(s.isTraversable(traversal({ kind: 'steps', hasStairs: null }))).toBe(false);
		});

		it('blocks paths marked inaccessible', () => {
			expect(s.isTraversable(traversal({ accessibility: 'inaccessible' }))).toBe(false);
		});

		it('blocks known grades steeper than 8.33% in either direction', () => {
			expect(s.isTraversable(traversal({ gradePercent: 8.34 }))).toBe(false);
			expect(s.isTraversable(traversal({ gradePercent: -8.34 }))).toBe(false);
		});

		it('allows grades at exactly the limit and unknown grades', () => {
			expect(s.isTraversable(traversal({ gradePercent: 8.33 }))).toBe(true);
			expect(s.isTraversable(traversal({ gradePercent: -8.33 }))).toBe(true);
			expect(s.isTraversable(traversal({ gradePercent: null }))).toBe(true);
		});

		it('allows paths with unknown accessibility (documented policy)', () => {
			expect(s.isTraversable(traversal({ accessibility: 'unknown' }))).toBe(true);
		});
	});

	describe('RS-1 entrances', () => {
		it('blocks inaccessible or stepped entrances', () => {
			expect(s.isEntranceUsable(entrance('e', 'n', { accessibility: 'inaccessible' }))).toBe(false);
			expect(s.isEntranceUsable(entrance('e', 'n', { hasSteps: true }))).toBe(false);
		});

		it('allows accessible, unknown, and unknown-steps entrances', () => {
			expect(s.isEntranceUsable(entrance('e', 'n'))).toBe(true);
			expect(s.isEntranceUsable(entrance('e', 'n', { accessibility: 'unknown' }))).toBe(true);
			expect(s.isEntranceUsable(entrance('e', 'n', { hasSteps: null }))).toBe(true);
		});
	});

	describe('RS-2', () => {
		it('costs distanceM on flat verified paths', () => {
			expect(s.edgeCost(traversal({ distanceM: 40, gradePercent: 0 }))).toBe(40);
		});

		it('adds an uphill factor but no downhill factor', () => {
			expect(s.edgeCost(traversal({ distanceM: 40, gradePercent: 5 }))).toBeCloseTo(60, 10);
			expect(s.edgeCost(traversal({ distanceM: 40, gradePercent: -5 }))).toBe(40);
		});

		it('charges ADA_UNVERIFIED_FACTOR for unknown accessibility', () => {
			expect(s.edgeCost(traversal({ distanceM: 40, accessibility: 'unknown' }))).toBe(60);
			expect(
				s.edgeCost(traversal({ distanceM: 40, accessibility: 'unknown', gradePercent: 5 }))
			).toBeCloseTo(40 * 1.5 * 1.5, 10);
		});

		it('adds no slope factor for a null grade', () => {
			expect(s.edgeCost(traversal({ distanceM: 40, gradePercent: null }))).toBe(40);
		});
	});
});
