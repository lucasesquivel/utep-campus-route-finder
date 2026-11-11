import { describe, expect, it } from 'vitest';
import type { RouteMode } from '../shared/types';
import { AdaRouteStrategy } from './AdaRouteStrategy';
import type { AccessibilityStatus, NodeId, PathTraversalView } from './campusDataView';
import { EasyRouteStrategy } from './EasyRouteStrategy';
import { RouteRequestError } from './errors';
import { RouteEngine } from './RouteEngine';
import type { RoutingStrategy } from './RoutingStrategy';
import { ShortestRouteStrategy } from './ShortestRouteStrategy';
import { entrance, FakeCampusGraph } from './testFixtures';
import type { FoundRouteResult, RouteRequest, RouteResult } from './types';

const allStrategies = (): RoutingStrategy[] => [
	new ShortestRouteStrategy(),
	new EasyRouteStrategy(),
	new AdaRouteStrategy()
];

function engine(graph: FakeCampusGraph, strategies = allStrategies()) {
	return new RouteEngine(graph, strategies);
}

function req(mode: RouteMode, origins: NodeId[], destinations: NodeId[]): RouteRequest {
	return {
		mode,
		origins: origins.map((nodeId) => ({ nodeId })),
		destinations: destinations.map((nodeId) => ({ nodeId }))
	};
}

function expectFound(result: RouteResult): FoundRouteResult {
	expect(result.status).toBe('found');
	return result as FoundRouteResult;
}

function expectError(fn: () => unknown, code: RouteRequestError['code']) {
	try {
		fn();
	} catch (e) {
		expect(e).toBeInstanceOf(RouteRequestError);
		expect((e as RouteRequestError).code).toBe(code);
		return;
	}
	throw new Error(`expected RouteRequestError ${code}`);
}

/**
 * Square with a short side route and a long detour:
 *   D(0,100) ---- C(100,100)
 *   |  (detour)    |
 *   A(0,0) ------ B(100,0)
 * A-D-C goes out to x = -80, so A-B-C is shorter.
 */
function square() {
	const g = new FakeCampusGraph()
		.addNode('A', 0, 0)
		.addNode('B', 100, 0)
		.addNode('C', 100, 100)
		.addNode('D', 0, 100);
	g.addEdge({ from: 'A', to: 'B' });
	g.addEdge({ from: 'B', to: 'C' });
	g.addEdge({ from: 'A', to: 'D', via: [[-80, 50]] });
	g.addEdge({ from: 'D', to: 'C' });
	return g;
}

/**
 * Stairs shortcut vs. a longer ramp:
 *   A(0,0) ==stairs (40 steps)== C(200,0)
 *        \                      /
 *         R(100,80)  ramp path
 */
function stairsVsRamp() {
	const g = new FakeCampusGraph().addNode('A', 0, 0).addNode('R', 100, 80).addNode('C', 200, 0);
	g.addEdge({ id: 'stairs', from: 'A', to: 'C', kind: 'steps', hasStairs: true, stepCount: 40 });
	g.addEdge({ id: 'ramp1', from: 'A', to: 'R', hasStairs: false });
	g.addEdge({ id: 'ramp2', from: 'R', to: 'C', hasStairs: false });
	return g;
}

describe('RouteEngine construction', () => {
	it('reports supported modes in registration order', () => {
		const e = new RouteEngine(square(), [new AdaRouteStrategy(), new ShortestRouteStrategy()]);
		expect(e.supportedModes()).toEqual(['ada', 'shortest']);
	});

	it('supports only Shortest in the Increment 1 configuration', () => {
		const e = new RouteEngine(square(), [new ShortestRouteStrategy()]);
		expect(e.supportedModes()).toEqual(['shortest']);
		expectError(() => e.calculateRoute(req('ada', ['A'], ['C'])), 'UNSUPPORTED_MODE');
	});

	it('rejects two strategies for the same mode', () => {
		expect(
			() => new RouteEngine(square(), [new ShortestRouteStrategy(), new ShortestRouteStrategy()])
		).toThrow(/more than one/i);
	});

	it('returns a frozen supportedModes list', () => {
		expect(Object.isFrozen(engine(square()).supportedModes())).toBe(true);
	});
});

describe('RT-1 preconditions throw RouteRequestError', () => {
	const g = square();
	const e = engine(g);

	it('EMPTY_ORIGINS', () => {
		expectError(() => e.calculateRoute(req('shortest', [], ['C'])), 'EMPTY_ORIGINS');
	});

	it('EMPTY_DESTINATIONS', () => {
		expectError(() => e.calculateRoute(req('shortest', ['A'], [])), 'EMPTY_DESTINATIONS');
	});

	it('UNSUPPORTED_MODE', () => {
		expectError(
			() => e.calculateRoute(req('teleport' as RouteMode, ['A'], ['C'])),
			'UNSUPPORTED_MODE'
		);
	});

	it('UNKNOWN_NODE for an unknown origin or destination', () => {
		expectError(() => e.calculateRoute(req('shortest', ['Z'], ['C'])), 'UNKNOWN_NODE');
		expectError(() => e.calculateRoute(req('shortest', ['A'], ['Z'])), 'UNKNOWN_NODE');
	});

	it('ENDPOINT_MISMATCH when entrance.nodeId differs from nodeId', () => {
		expectError(
			() =>
				e.calculateRoute({
					mode: 'shortest',
					origins: [{ nodeId: 'A', entrance: entrance('e1', 'B') }],
					destinations: [{ nodeId: 'C' }]
				}),
			'ENDPOINT_MISMATCH'
		);
	});

	it('reports the first violation in contract order', () => {
		expectError(() => e.calculateRoute(req('teleport' as RouteMode, [], [])), 'EMPTY_ORIGINS');
	});
});

describe('RT-1 Shortest mode', () => {
	it('finds the shortest path', () => {
		const g = square();
		const { route } = expectFound(engine(g).calculateRoute(req('shortest', ['A'], ['C'])));
		expect(route.nodeIds).toEqual(['A', 'B', 'C']);
		expect(route.mode).toBe('shortest');
		expect(route.totalDistanceM).toBeCloseTo(200, 0);
		expect(route.totalCost).toBeCloseTo(route.totalDistanceM, 9);
	});

	it('finds the same path in reverse', () => {
		const { route } = expectFound(engine(square()).calculateRoute(req('shortest', ['C'], ['A'])));
		expect(route.nodeIds).toEqual(['C', 'B', 'A']);
	});

	it('uses stairs freely', () => {
		const { route } = expectFound(
			engine(stairsVsRamp()).calculateRoute(req('shortest', ['A'], ['C']))
		);
		expect(route.nodeIds).toEqual(['A', 'C']);
		expect(route.stairSegmentCount).toBe(1);
	});

	it('returns a zero-length route when an origin is also a destination', () => {
		const { route } = expectFound(
			engine(square()).calculateRoute(req('shortest', ['A', 'B'], ['C', 'B']))
		);
		expect(route.nodeIds).toEqual(['B']);
		expect(route.totalDistanceM).toBe(0);
		expect(route.totalCost).toBe(0);
		expect(route.coordinates).toHaveLength(1);
	});

	it('picks the best pair among several origins and destinations', () => {
		// Line 0 - 1 - 2 - 3 - 4 - 5 at 50 m spacing.
		const g = new FakeCampusGraph();
		for (let i = 0; i <= 5; i++) g.addNode(`n${i}`, i * 50, 0);
		for (let i = 0; i < 5; i++) g.addEdge({ from: `n${i}`, to: `n${i + 1}` });
		const { route } = expectFound(
			engine(g).calculateRoute(req('shortest', ['n0', 'n2'], ['n5', 'n3']))
		);
		expect(route.origin.nodeId).toBe('n2');
		expect(route.destination.nodeId).toBe('n3');
		expect(route.nodeIds).toEqual(['n2', 'n3']);
	});

	it('returns UNREACHABLE when the graph is disconnected', () => {
		const g = square().addNode('X', 500, 500);
		const result = engine(g).calculateRoute(req('shortest', ['A'], ['X']));
		expect(result).toEqual({ status: 'no-route', mode: 'shortest', reason: 'UNREACHABLE' });
	});

	it('reports the chosen entrances on the route endpoints', () => {
		const g = square();
		const front = entrance('front', 'A');
		const back = entrance('back', 'D');
		const target = entrance('lobby', 'C');
		const { route } = expectFound(
			engine(g).calculateRoute({
				mode: 'shortest',
				origins: [
					{ nodeId: 'D', entrance: back },
					{ nodeId: 'A', entrance: front }
				],
				destinations: [{ nodeId: 'C', entrance: target }]
			})
		);
		// D-C is 100 m, A-B-C is 200 m: the back entrance wins.
		expect(route.origin.entrance).toBe(back);
		expect(route.destination.entrance).toBe(target);
	});

	it('returns a coordinate chain that starts at the origin and ends at the destination', () => {
		const g = square();
		const { route } = expectFound(engine(g).calculateRoute(req('shortest', ['A'], ['C'])));
		expect(route.coordinates[0]).toEqual(g.getNode('A')!.location);
		expect(route.coordinates[route.coordinates.length - 1]).toEqual(g.getNode('C')!.location);
	});
});

describe('RT-1 ADA mode', () => {
	it('avoids stairs and takes the ramp', () => {
		const { route } = expectFound(engine(stairsVsRamp()).calculateRoute(req('ada', ['A'], ['C'])));
		expect(route.nodeIds).toEqual(['A', 'R', 'C']);
		expect(route.stairSegmentCount).toBe(0);
	});

	it('returns UNREACHABLE when stairs are the only connection', () => {
		const g = new FakeCampusGraph().addNode('A', 0, 0).addNode('B', 50, 0);
		g.addEdge({ from: 'A', to: 'B', hasStairs: true });
		expect(engine(g).calculateRoute(req('ada', ['A'], ['B']))).toEqual({
			status: 'no-route',
			mode: 'ada',
			reason: 'UNREACHABLE'
		});
	});

	it('avoids grades steeper than 8.33%', () => {
		const g = new FakeCampusGraph().addNode('A', 0, 0).addNode('M', 50, 40).addNode('B', 100, 0);
		g.addEdge({ id: 'steep', from: 'A', to: 'B', gradePercent: 10 });
		g.addEdge({ from: 'A', to: 'M', gradePercent: 4 });
		g.addEdge({ from: 'M', to: 'B', gradePercent: 4 });
		const result = engine(g).calculateRoute(req('ada', ['A'], ['B']));
		expect(expectFound(result).route.nodeIds).toEqual(['A', 'M', 'B']);
	});

	it('blocks a too-steep path when travelled downhill as well', () => {
		const g = new FakeCampusGraph().addNode('A', 0, 0).addNode('B', 100, 0);
		g.addEdge({ from: 'A', to: 'B', gradePercent: 9 });
		expect(engine(g).calculateRoute(req('ada', ['B'], ['A'])).status).toBe('no-route');
	});

	it('skips stepped entrances and uses an accessible one', () => {
		const g = square();
		const { route } = expectFound(
			engine(g).calculateRoute({
				mode: 'ada',
				origins: [
					{ nodeId: 'D', entrance: entrance('stepped', 'D', { hasSteps: true }) },
					{ nodeId: 'A', entrance: entrance('ramp', 'A') }
				],
				destinations: [{ nodeId: 'C' }]
			})
		);
		expect(route.origin.entrance?.id).toBe('ramp');
		expect(route.nodeIds).toEqual(['A', 'B', 'C']);
	});

	it('keeps a later endpoint on the same node when the first one is unusable', () => {
		const g = square();
		const { route } = expectFound(
			engine(g).calculateRoute({
				mode: 'ada',
				origins: [
					{ nodeId: 'A', entrance: entrance('side', 'A', { accessibility: 'inaccessible' }) },
					{ nodeId: 'A', entrance: entrance('main', 'A') }
				],
				destinations: [{ nodeId: 'C' }]
			})
		);
		expect(route.origin.entrance?.id).toBe('main');
	});

	it('returns NO_USABLE_ORIGIN when every origin entrance is unusable', () => {
		const result = engine(square()).calculateRoute({
			mode: 'ada',
			origins: [{ nodeId: 'A', entrance: entrance('e', 'A', { hasSteps: true }) }],
			destinations: [{ nodeId: 'C' }]
		});
		expect(result).toEqual({ status: 'no-route', mode: 'ada', reason: 'NO_USABLE_ORIGIN' });
	});

	it('returns NO_USABLE_DESTINATION when every destination entrance is unusable', () => {
		const result = engine(square()).calculateRoute({
			mode: 'ada',
			origins: [{ nodeId: 'A' }],
			destinations: [
				{ nodeId: 'C', entrance: entrance('e', 'C', { accessibility: 'inaccessible' }) }
			]
		});
		expect(result).toEqual({ status: 'no-route', mode: 'ada', reason: 'NO_USABLE_DESTINATION' });
	});

	it('checks origins before destinations', () => {
		const result = engine(square()).calculateRoute({
			mode: 'ada',
			origins: [{ nodeId: 'A', entrance: entrance('o', 'A', { hasSteps: true }) }],
			destinations: [{ nodeId: 'C', entrance: entrance('d', 'C', { hasSteps: true }) }]
		});
		expect(result.status === 'no-route' && result.reason).toBe('NO_USABLE_ORIGIN');
	});

	it('the same entrances are fine in Shortest mode', () => {
		const result = engine(square()).calculateRoute({
			mode: 'shortest',
			origins: [{ nodeId: 'A', entrance: entrance('o', 'A', { hasSteps: true }) }],
			destinations: [{ nodeId: 'C', entrance: entrance('d', 'C', { hasSteps: true }) }]
		});
		expect(result.status).toBe('found');
	});

	function verifiedVsUnknown(verifiedDetourY: number) {
		const g = new FakeCampusGraph()
			.addNode('A', 0, 0)
			.addNode('B', 100, 0)
			.addNode('V', 50, verifiedDetourY);
		g.addEdge({ id: 'unknown', from: 'A', to: 'B', accessibility: 'unknown' });
		g.addEdge({ from: 'A', to: 'V', accessibility: 'accessible' });
		g.addEdge({ from: 'V', to: 'B', accessibility: 'accessible' });
		return g;
	}

	it('prefers a verified path when it is less than 1.5x longer', () => {
		// Verified detour ~ 2 x sqrt(50^2 + 40^2) = 128 m < 150 cost of the unknown path.
		const { route } = expectFound(
			engine(verifiedVsUnknown(40)).calculateRoute(req('ada', ['A'], ['B']))
		);
		expect(route.nodeIds).toEqual(['A', 'V', 'B']);
		expect(route.unverifiedAccessibilityDistanceM).toBe(0);
	});

	it('uses an unknown path when the verified one is much longer, and reports it', () => {
		// Verified detour ~ 2 x sqrt(50^2 + 80^2) = 189 m > 150 cost of the unknown path.
		const { route } = expectFound(
			engine(verifiedVsUnknown(80)).calculateRoute(req('ada', ['A'], ['B']))
		);
		expect(route.nodeIds).toEqual(['A', 'B']);
		expect(route.unverifiedAccessibilityDistanceM).toBeCloseTo(100, 0);
		expect(route.totalCost).toBeCloseTo(route.totalDistanceM * 1.5, 6);
	});
});

/**
 * OpenStreetMap rarely tags footways with wheelchair information, so real campus data is
 * mostly 'unknown'. These tests use that shape instead of the 'accessible' fixture default.
 */
describe('RT-1 ADA mode with OSM-like data (mostly unknown accessibility)', () => {
	const SIZE = 6;
	const SPACING_M = 60;
	const nodeAt = (row: number, col: number): NodeId => `n${row}-${col}`;

	/** Same sequence on every run, so a failing "random" graph can be reproduced. */
	function seededRandom(seed: number): () => number {
		let state = seed;
		return () => {
			state = (state * 1664525 + 1013904223) % 4294967296;
			return state / 4294967296;
		};
	}

	/** SIZE x SIZE street grid; pickStatus decides each path's accessibility. */
	function osmLikeGrid(pickStatus: () => AccessibilityStatus): FakeCampusGraph {
		const graph = new FakeCampusGraph('unknown');
		for (let row = 0; row < SIZE; row++) {
			for (let col = 0; col < SIZE; col++) {
				graph.addNode(nodeAt(row, col), col * SPACING_M, row * SPACING_M);
			}
		}
		for (let row = 0; row < SIZE; row++) {
			for (let col = 0; col < SIZE; col++) {
				if (col + 1 < SIZE) {
					graph.addEdge({
						from: nodeAt(row, col),
						to: nodeAt(row, col + 1),
						accessibility: pickStatus()
					});
				}
				if (row + 1 < SIZE) {
					graph.addEdge({
						from: nodeAt(row, col),
						to: nodeAt(row + 1, col),
						accessibility: pickStatus()
					});
				}
			}
		}
		return graph;
	}

	const unknownDistanceM = (traversals: readonly PathTraversalView[]) =>
		traversals
			.filter((t) => t.edge.accessibility.status === 'unknown')
			.reduce((sum, t) => sum + t.distanceM, 0);

	it('still finds a route when every path is unknown, and flags all of it as unverified', () => {
		const graph = osmLikeGrid(() => 'unknown');
		const e = engine(graph);
		const request = (mode: RouteMode) => req(mode, [nodeAt(0, 0)], [nodeAt(SIZE - 1, SIZE - 1)]);

		const shortest = expectFound(e.calculateRoute(request('shortest'))).route;
		const ada = expectFound(e.calculateRoute(request('ada'))).route;

		expect(ada.totalDistanceM).toBeCloseTo(shortest.totalDistanceM, 6);
		expect(ada.unverifiedAccessibilityDistanceM).toBeCloseTo(ada.totalDistanceM, 6);
		expect(ada.totalCost).toBeCloseTo(
			ada.totalDistanceM * AdaRouteStrategy.ADA_UNVERIFIED_FACTOR,
			6
		);
	});

	it('gives the UI what it needs to warn: unverified distance on the Route and in GeoJSON', () => {
		const graph = osmLikeGrid(() => 'unknown');
		const { route } = expectFound(
			engine(graph).calculateRoute(req('ada', [nodeAt(0, 0)], [nodeAt(0, SIZE - 1)]))
		);

		expect(route.unverifiedAccessibilityDistanceM).toBeGreaterThan(0);
		expect(route.toGeoJson().properties.unverifiedAccessibilityDistanceM).toBe(
			route.unverifiedAccessibilityDistanceM
		);
	});

	it('reports exactly the unknown part of a route over a mostly-unknown campus', () => {
		// About 85% unknown, 15% verified accessible, from a fixed seed.
		const random = seededRandom(42);
		const graph = osmLikeGrid(() => (random() < 0.85 ? 'unknown' : 'accessible'));
		const e = engine(graph);
		const corners = [
			nodeAt(0, 0),
			nodeAt(0, SIZE - 1),
			nodeAt(SIZE - 1, 0),
			nodeAt(SIZE - 1, SIZE - 1)
		];

		let routesWithWarning = 0;
		for (const from of corners) {
			for (const to of corners) {
				if (from === to) continue;
				const { route } = expectFound(e.calculateRoute(req('ada', [from], [to])));
				expect(route.unverifiedAccessibilityDistanceM).toBeCloseTo(
					unknownDistanceM(route.traversals),
					6
				);
				expect(route.unverifiedAccessibilityDistanceM).toBeLessThanOrEqual(
					route.totalDistanceM + 1e-9
				);
				if (route.unverifiedAccessibilityDistanceM > 0) routesWithWarning += 1;
			}
		}
		// Guards against the test passing only because the graph happened to be fully verified.
		expect(routesWithWarning).toBeGreaterThan(0);
	});

	it('never routes over inaccessible paths or stairs, even when the rest is unknown', () => {
		// ~80% unknown, ~10% verified, ~10% marked inaccessible.
		const random = seededRandom(7);
		const graph = osmLikeGrid(() => {
			const roll = random();
			return roll < 0.8 ? 'unknown' : roll < 0.9 ? 'accessible' : 'inaccessible';
		});
		const e = engine(graph);

		let found = 0;
		for (const to of [nodeAt(0, SIZE - 1), nodeAt(SIZE - 1, 0), nodeAt(SIZE - 1, SIZE - 1)]) {
			const result = e.calculateRoute(req('ada', [nodeAt(0, 0)], [to]));
			if (result.status === 'no-route') {
				expect(result.reason).toBe('UNREACHABLE');
				continue;
			}
			found += 1;
			for (const t of result.route.traversals) {
				expect(t.edge.accessibility.status).not.toBe('inaccessible');
				expect(t.edge.hasStairs).not.toBe(true);
			}
		}
		expect(found).toBeGreaterThan(0);
	});

	it('avoids an untagged staircase (kind steps, hasStairs and accessibility unknown)', () => {
		// OSM often tags only highway=steps, leaving the other facts null/unknown.
		const graph = new FakeCampusGraph('unknown')
			.addNode('A', 0, 0)
			.addNode('B', 200, 0)
			.addNode('D', 100, 120);
		graph.addEdge({ id: 'steps', from: 'A', to: 'B', kind: 'steps', hasStairs: null });
		graph.addEdge({ from: 'A', to: 'D' });
		graph.addEdge({ from: 'D', to: 'B' });
		const e = engine(graph);

		const { route } = expectFound(e.calculateRoute(req('ada', ['A'], ['B'])));
		expect(route.nodeIds).toEqual(['A', 'D', 'B']);
		expect(route.stairSegmentCount).toBe(0);

		const stepsOnly = new FakeCampusGraph('unknown').addNode('A', 0, 0).addNode('B', 200, 0);
		stepsOnly.addEdge({ from: 'A', to: 'B', kind: 'steps', hasStairs: null });
		expect(engine(stepsOnly).calculateRoute(req('ada', ['A'], ['B']))).toMatchObject({
			status: 'no-route',
			reason: 'UNREACHABLE'
		});
	});

	it('keeps an unknown entrance usable and leaves it on the Route for the UI to check', () => {
		const graph = osmLikeGrid(() => 'unknown');
		const unknownEntrance = (id: string, nodeId: NodeId) =>
			entrance(id, nodeId, { hasSteps: null, accessibility: 'unknown' });

		const result = engine(graph).calculateRoute({
			mode: 'ada',
			origins: [{ nodeId: nodeAt(0, 0), entrance: unknownEntrance('o', nodeAt(0, 0)) }],
			destinations: [
				{
					nodeId: nodeAt(SIZE - 1, SIZE - 1),
					entrance: unknownEntrance('d', nodeAt(SIZE - 1, SIZE - 1))
				}
			]
		});

		const { route } = expectFound(result);
		expect(route.origin.entrance?.accessibility.status).toBe('unknown');
		expect(route.destination.entrance?.accessibility.status).toBe('unknown');
	});
});

describe('RT-1 Easy mode', () => {
	it('prefers the ramp when the stair penalty outweighs the detour', () => {
		// Stairs: 200 + 25 + 1.5 x 40 = 285 vs ramp ~256 m.
		const { route } = expectFound(engine(stairsVsRamp()).calculateRoute(req('easy', ['A'], ['C'])));
		expect(route.nodeIds).toEqual(['A', 'R', 'C']);
	});

	it('still uses stairs when they are the only way (never forbids)', () => {
		const g = new FakeCampusGraph().addNode('A', 0, 0).addNode('B', 50, 0);
		g.addEdge({ from: 'A', to: 'B', hasStairs: true, stepCount: 10 });
		const { route } = expectFound(engine(g).calculateRoute(req('easy', ['A'], ['B'])));
		expect(route.totalCost).toBeCloseTo(50 + 25 + 15, 0);
	});

	/**
	 * Two parallel paths A-B: a straight 100 m path with +8% grade from A to B, and a flat
	 * detour of about 130 m. Uphill (A->B) the steep path costs 180, so the detour wins;
	 * downhill (B->A) it costs 124, so the steep path wins.
	 */
	function hill() {
		const g = new FakeCampusGraph().addNode('A', 0, 0).addNode('B', 100, 0).addNode('F', 50, 41.53);
		g.addEdge({ id: 'steep', from: 'A', to: 'B', gradePercent: 8 });
		g.addEdge({ from: 'A', to: 'F', gradePercent: 0 });
		g.addEdge({ from: 'F', to: 'B', gradePercent: 0 });
		return g;
	}

	it('avoids a steep climb uphill', () => {
		const { route } = expectFound(engine(hill()).calculateRoute(req('easy', ['A'], ['B'])));
		expect(route.nodeIds).toEqual(['A', 'F', 'B']);
	});

	it('accepts the same slope downhill (direction-aware grade)', () => {
		const { route } = expectFound(engine(hill()).calculateRoute(req('easy', ['B'], ['A'])));
		expect(route.nodeIds).toEqual(['B', 'A']);
		expect(route.totalCost).toBeCloseTo(100 * (1 + 0.03 * 8), 0);
	});

	it('finds a route whenever Shortest does', () => {
		const g = stairsVsRamp().addNode('X', 900, 900);
		for (const [o, d] of [
			['A', 'C'],
			['C', 'R'],
			['A', 'X']
		] as const) {
			const shortest = engine(g).calculateRoute(req('shortest', [o], [d]));
			const easy = engine(g).calculateRoute(req('easy', [o], [d]));
			expect(easy.status).toBe(shortest.status);
		}
	});
});

describe('RT-1 general postconditions', () => {
	it('is deterministic with fixed tie-breaking on equal-cost paths', () => {
		// Diamond: A -> (U or L) -> B, both exactly 2 x sqrt(50^2 + 50^2).
		const build = () => {
			const g = new FakeCampusGraph()
				.addNode('A', 0, 0)
				.addNode('U', 50, 50)
				.addNode('L', 50, -50)
				.addNode('B', 100, 0);
			g.addEdge({ from: 'A', to: 'U', distanceM: 80 });
			g.addEdge({ from: 'U', to: 'B', distanceM: 80 });
			g.addEdge({ from: 'A', to: 'L', distanceM: 80 });
			g.addEdge({ from: 'L', to: 'B', distanceM: 80 });
			return g;
		};
		const first = expectFound(engine(build()).calculateRoute(req('shortest', ['A'], ['B'])));
		for (let i = 0; i < 5; i++) {
			const again = expectFound(engine(build()).calculateRoute(req('shortest', ['A'], ['B'])));
			expect(again.route.nodeIds).toEqual(first.route.nodeIds);
		}
		expect(first.route.totalDistanceM).toBe(160);
	});

	it('does not modify the graph or the strategies', () => {
		const g = stairsVsRamp().freeze();
		const strategies = allStrategies().map((s) => Object.freeze(s));
		const e = new RouteEngine(g, strategies);
		for (const mode of ['shortest', 'easy', 'ada'] as const) {
			expect(() => e.calculateRoute(req(mode, ['A'], ['C']))).not.toThrow();
		}
	});

	it('keeps no state between calls (repeat and interleaved calls agree)', () => {
		const g = stairsVsRamp();
		const e = engine(g);
		const a1 = expectFound(e.calculateRoute(req('ada', ['A'], ['C'])));
		const s1 = expectFound(e.calculateRoute(req('shortest', ['A'], ['C'])));
		const a2 = expectFound(e.calculateRoute(req('ada', ['A'], ['C'])));
		const s2 = expectFound(e.calculateRoute(req('shortest', ['A'], ['C'])));
		expect(a2.route.nodeIds).toEqual(a1.route.nodeIds);
		expect(s2.route.nodeIds).toEqual(s1.route.nodeIds);
		expect(a1.route.nodeIds).not.toEqual(s1.route.nodeIds);
	});

	it('returns frozen results', () => {
		const e = engine(square().addNode('X', 900, 900));
		expect(Object.isFrozen(e.calculateRoute(req('shortest', ['A'], ['C'])))).toBe(true);
		expect(Object.isFrozen(e.calculateRoute(req('shortest', ['A'], ['X'])))).toBe(true);
	});

	it('throws when a strategy breaks RS-2 (cost below distance)', () => {
		const cheat: RoutingStrategy = {
			mode: 'shortest',
			isTraversable: () => true,
			isEntranceUsable: () => true,
			edgeCost: (t: PathTraversalView) => t.distanceM / 2
		};
		expect(() =>
			new RouteEngine(square(), [cheat]).calculateRoute(req('shortest', ['A'], ['C']))
		).toThrow(/RS-2/);
	});

	it('throws when a strategy returns a non-finite cost', () => {
		const broken: RoutingStrategy = {
			mode: 'shortest',
			isTraversable: () => true,
			isEntranceUsable: () => true,
			edgeCost: () => Number.NaN
		};
		expect(() =>
			new RouteEngine(square(), [broken]).calculateRoute(req('shortest', ['A'], ['C']))
		).toThrow(/RS-2/);
	});

	it('stops at the first goal popped instead of exploring the whole graph', () => {
		// Two nodes next to each other, plus a long chain hanging off the origin.
		const g = new FakeCampusGraph().addNode('A', 0, 0).addNode('B', 10, 0);
		g.addEdge({ from: 'A', to: 'B' });
		let prev = 'A';
		for (let i = 0; i < 200; i++) {
			const id = `far${i}`;
			g.addNode(id, -20 - i * 20, 0);
			g.addEdge({ from: prev, to: id });
			prev = id;
		}
		expectFound(engine(g).calculateRoute(req('shortest', ['A'], ['B'])));
		expect(g.neighborCalls).toBeLessThan(5);
	});

	it('route cost equals the sum of strategy edge costs along the route', () => {
		const g = stairsVsRamp();
		for (const strategy of allStrategies()) {
			const { route } = expectFound(engine(g).calculateRoute(req(strategy.mode, ['A'], ['C'])));
			const sum = route.traversals.reduce((acc, t) => acc + strategy.edgeCost(t), 0);
			expect(route.totalCost).toBeCloseTo(sum, 9);
		}
	});
});

/* ------------------------------------------------------------------------------------- */
/* Randomized check: A* must match a brute-force Dijkstra on many random campus graphs.   */
/* ------------------------------------------------------------------------------------- */

function makeRng(seed: number) {
	let s = seed >>> 0;
	return () => {
		// xorshift32
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		return (s >>> 0) / 2 ** 32;
	};
}

function randomGraph(seed: number) {
	const rand = makeRng(seed);
	const g = new FakeCampusGraph();
	const size = 6;
	const id = (x: number, y: number) => `n${x}_${y}`;
	for (let x = 0; x < size; x++) {
		for (let y = 0; y < size; y++) {
			g.addNode(id(x, y), x * 60 + rand() * 20, y * 60 + rand() * 20);
		}
	}
	const addRandomEdge = (from: string, to: string) => {
		if (rand() < 0.15) return; // missing path
		const roll = rand();
		g.addEdge({
			from,
			to,
			hasStairs: roll < 0.15,
			kind: roll < 0.15 ? 'steps' : 'footway',
			stepCount: roll < 0.1 ? Math.floor(rand() * 30) : null,
			accessibility: rand() < 0.1 ? 'inaccessible' : rand() < 0.4 ? 'unknown' : 'accessible',
			gradePercent: rand() < 0.2 ? null : (rand() - 0.5) * 24,
			// Some edges bend, so distanceM exceeds the straight line.
			via: rand() < 0.3 ? [[rand() * 300, rand() * 300]] : undefined
		});
	};
	for (let x = 0; x < size; x++) {
		for (let y = 0; y < size; y++) {
			if (x + 1 < size) addRandomEdge(id(x, y), id(x + 1, y));
			if (y + 1 < size) addRandomEdge(id(x, y), id(x, y + 1));
			if (x + 1 < size && y + 1 < size && rand() < 0.3) addRandomEdge(id(x, y), id(x + 1, y + 1));
		}
	}
	return { g, rand };
}

/** Multi-source Dijkstra with an O(V^2) scan: slow but obviously correct. */
function referenceCost(
	g: FakeCampusGraph,
	strategy: RoutingStrategy,
	origins: NodeId[],
	destinations: NodeId[]
): number {
	const dist = new Map<NodeId, number>(g.nodeIds().map((id) => [id, Infinity]));
	const done = new Set<NodeId>();
	for (const o of origins) dist.set(o, 0);
	for (;;) {
		let best: NodeId | undefined;
		for (const [id, d] of dist) {
			if (!done.has(id) && d < Infinity && (best === undefined || d < dist.get(best)!)) best = id;
		}
		if (best === undefined) break;
		done.add(best);
		for (const t of g.getNeighbors(best)) {
			if (!strategy.isTraversable(t)) continue;
			const nd = dist.get(best)! + strategy.edgeCost(t);
			if (nd < dist.get(t.toNodeId)!) dist.set(t.toNodeId, nd);
		}
	}
	return Math.min(...destinations.map((d) => dist.get(d)!));
}

describe('RT-1 optimality against a reference Dijkstra (randomized)', () => {
	const strategies = allStrategies();

	it('matches the optimal cost on 60 random graphs x 3 modes', () => {
		let found = 0;
		let unreachable = 0;
		for (let seed = 1; seed <= 60; seed++) {
			const { g, rand } = randomGraph(seed);
			const ids = g.nodeIds();
			const pick = () => ids[Math.floor(rand() * ids.length)];
			const origins = Array.from({ length: 1 + Math.floor(rand() * 3) }, pick);
			const destinations = Array.from({ length: 1 + Math.floor(rand() * 3) }, pick);

			for (const strategy of strategies) {
				const result = new RouteEngine(g, strategies).calculateRoute(
					req(strategy.mode, origins, destinations)
				);
				const expected = referenceCost(g, strategy, origins, destinations);

				if (expected === Infinity) {
					expect(result).toMatchObject({ status: 'no-route', reason: 'UNREACHABLE' });
					unreachable++;
					continue;
				}
				const { route } = expectFound(result);
				found++;
				expect(route.totalCost).toBeCloseTo(expected, 6);
				expect(origins).toContain(route.nodeIds[0]);
				expect(destinations).toContain(route.nodeIds[route.nodeIds.length - 1]);
				for (const t of route.traversals) expect(strategy.isTraversable(t)).toBe(true);
			}
		}
		// The generator should exercise both outcomes.
		expect(found).toBeGreaterThan(50);
		expect(unreachable).toBeGreaterThan(0);
	});

	it('other modes are never shorter in distance than Shortest', () => {
		for (let seed = 100; seed < 140; seed++) {
			const { g, rand } = randomGraph(seed);
			const ids = g.nodeIds();
			const o = ids[Math.floor(rand() * ids.length)];
			const d = ids[Math.floor(rand() * ids.length)];
			const e = new RouteEngine(g, strategies);
			const shortest = e.calculateRoute(req('shortest', [o], [d]));
			if (shortest.status !== 'found') continue;
			for (const mode of ['easy', 'ada'] as const) {
				const other = e.calculateRoute(req(mode, [o], [d]));
				if (other.status === 'found') {
					expect(other.route.totalDistanceM).toBeGreaterThanOrEqual(
						shortest.route.totalDistanceM - 1e-6
					);
				}
			}
		}
	});
});
