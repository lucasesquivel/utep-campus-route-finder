import { describe, expect, it } from 'vitest';
import type { NodeId, PathTraversalView } from './campusDataView';
import { Route, WALKING_SPEED_MPS } from './Route';
import { at, entrance, FakeCampusGraph } from './testFixtures';

/**
 * Line graph A(0,0) - B(100,0) - C(100,60) with a bend point on B-C.
 * A-B is stored A->B; B-C is stored C->B so travelling B->C reverses its geometry.
 */
function lineGraph() {
	const g = new FakeCampusGraph().addNode('A', 0, 0).addNode('B', 100, 0).addNode('C', 100, 60);
	g.addEdge({ from: 'A', to: 'B', elevationChangeM: 2, accessibility: 'accessible' });
	g.addEdge({
		from: 'C',
		to: 'B',
		via: [[120, 30]],
		elevationChangeM: 3,
		hasStairs: true,
		stepCount: 10,
		accessibility: 'unknown'
	});
	return g;
}

function step(g: FakeCampusGraph, from: NodeId, to: NodeId): PathTraversalView {
	const t = g.getNeighbors(from).find((x) => x.toNodeId === to);
	if (!t) throw new Error(`no traversal ${from}->${to}`);
	return t;
}

function build(g: FakeCampusGraph, path: NodeId[], totalCost = 0) {
	const traversals = path.slice(1).map((to, i) => step(g, path[i], to));
	return Route.build({
		mode: 'shortest',
		origin: { nodeId: path[0] },
		destination: { nodeId: path[path.length - 1] },
		originLocation: g.getNode(path[0])!.location,
		traversals,
		totalCost
	});
}

describe('Route.build (RO-1)', () => {
	it('records nodeIds from origin to destination', () => {
		const route = build(lineGraph(), ['A', 'B', 'C']);
		expect(route.nodeIds).toEqual(['A', 'B', 'C']);
		expect(route.traversals).toHaveLength(2);
	});

	it('sums distance and derives walking time at 1.3 m/s', () => {
		const g = lineGraph();
		const route = build(g, ['A', 'B', 'C']);
		const expected = step(g, 'A', 'B').distanceM + step(g, 'B', 'C').distanceM;
		expect(route.totalDistanceM).toBeCloseTo(expected, 9);
		expect(WALKING_SPEED_MPS).toBe(1.3);
		expect(route.estimatedWalkTimeS).toBeCloseTo(expected / 1.3, 9);
	});

	it('joins geometry in travel order, reversing edges stored the other way, without repeated joints', () => {
		const route = build(lineGraph(), ['A', 'B', 'C']);
		// A, B (joint, once), bend, C.
		expect(route.coordinates).toEqual([at(0, 0), at(100, 0), at(120, 30), at(100, 60)]);
	});

	it('joins geometry correctly when travelling the whole line backwards', () => {
		const route = build(lineGraph(), ['C', 'B', 'A']);
		expect(route.coordinates).toEqual([at(100, 60), at(120, 30), at(100, 0), at(0, 0)]);
	});

	it('sums elevation gain and loss for the direction of travel', () => {
		const forward = build(lineGraph(), ['A', 'B', 'C']);
		// A->B +2; B->C is the reverse of C->B (+3), so -3.
		expect(forward.elevationGainM).toBeCloseTo(2, 9);
		expect(forward.elevationLossM).toBeCloseTo(3, 9);
		expect(forward.elevationComplete).toBe(true);

		const backward = build(lineGraph(), ['C', 'B', 'A']);
		expect(backward.elevationGainM).toBeCloseTo(3, 9);
		expect(backward.elevationLossM).toBeCloseTo(2, 9);
	});

	it('marks elevation incomplete when any change is unknown', () => {
		const g = new FakeCampusGraph().addNode('A', 0, 0).addNode('B', 50, 0).addNode('C', 100, 0);
		g.addEdge({ from: 'A', to: 'B', elevationChangeM: 4 });
		g.addEdge({ from: 'B', to: 'C', elevationChangeM: null });
		const route = build(g, ['A', 'B', 'C']);
		expect(route.elevationComplete).toBe(false);
		expect(route.elevationGainM).toBeCloseTo(4, 9);
		expect(route.elevationLossM).toBe(0);
	});

	it('counts stair segments and unverified accessibility distance', () => {
		const g = lineGraph();
		const route = build(g, ['A', 'B', 'C']);
		expect(route.stairSegmentCount).toBe(1);
		expect(route.unverifiedAccessibilityDistanceM).toBeCloseTo(step(g, 'B', 'C').distanceM, 9);
	});

	it('builds a zero-length route with one coordinate', () => {
		const g = lineGraph();
		const route = Route.build({
			mode: 'ada',
			origin: { nodeId: 'B' },
			destination: { nodeId: 'B' },
			originLocation: g.getNode('B')!.location,
			traversals: [],
			totalCost: 0
		});
		expect(route.nodeIds).toEqual(['B']);
		expect(route.coordinates).toEqual([at(100, 0)]);
		expect(route.totalDistanceM).toBe(0);
		expect(route.estimatedWalkTimeS).toBe(0);
		expect(route.elevationComplete).toBe(true);
		expect(route.stairSegmentCount).toBe(0);
	});

	it('keeps mode, endpoints and totalCost as given', () => {
		const g = lineGraph();
		const e = entrance('main', 'A');
		const route = Route.build({
			mode: 'easy',
			origin: { nodeId: 'A', entrance: e },
			destination: { nodeId: 'B' },
			originLocation: g.getNode('A')!.location,
			traversals: [step(g, 'A', 'B')],
			totalCost: 123.5
		});
		expect(route.mode).toBe('easy');
		expect(route.origin.entrance).toBe(e);
		expect(route.destination.nodeId).toBe('B');
		expect(route.totalCost).toBe(123.5);
	});

	it('freezes the Route and all its arrays', () => {
		const route = build(lineGraph(), ['A', 'B', 'C']);
		expect(Object.isFrozen(route)).toBe(true);
		expect(Object.isFrozen(route.nodeIds)).toBe(true);
		expect(Object.isFrozen(route.traversals)).toBe(true);
		expect(Object.isFrozen(route.coordinates)).toBe(true);
		expect(Object.isFrozen(route.coordinates[0])).toBe(true);
		expect(() => {
			(route as { totalDistanceM: number }).totalDistanceM = 0;
		}).toThrow(TypeError);
	});

	it('does not alias the caller traversal array', () => {
		const g = lineGraph();
		const traversals = [step(g, 'A', 'B')];
		const route = Route.build({
			mode: 'shortest',
			origin: { nodeId: 'A' },
			destination: { nodeId: 'B' },
			originLocation: g.getNode('A')!.location,
			traversals,
			totalCost: 0
		});
		traversals.push(step(g, 'B', 'C'));
		expect(route.traversals).toHaveLength(1);
	});

	describe('precondition violations throw RangeError', () => {
		const g = lineGraph();
		const base = {
			mode: 'shortest' as const,
			originLocation: g.getNode('A')!.location,
			totalCost: 0
		};

		it('first traversal does not start at origin', () => {
			expect(() =>
				Route.build({
					...base,
					origin: { nodeId: 'A' },
					destination: { nodeId: 'C' },
					traversals: [step(g, 'B', 'C')]
				})
			).toThrow(RangeError);
		});

		it('traversals are not connected', () => {
			expect(() =>
				Route.build({
					...base,
					origin: { nodeId: 'A' },
					destination: { nodeId: 'B' },
					traversals: [step(g, 'A', 'B'), step(g, 'C', 'B')]
				})
			).toThrow(RangeError);
		});

		it('last traversal does not end at destination', () => {
			expect(() =>
				Route.build({
					...base,
					origin: { nodeId: 'A' },
					destination: { nodeId: 'C' },
					traversals: [step(g, 'A', 'B')]
				})
			).toThrow(RangeError);
		});

		it('empty traversals with different origin and destination', () => {
			expect(() =>
				Route.build({
					...base,
					origin: { nodeId: 'A' },
					destination: { nodeId: 'B' },
					traversals: []
				})
			).toThrow(RangeError);
		});

		it('negative or non-finite totalCost', () => {
			const ok = { ...base, origin: { nodeId: 'A' }, destination: { nodeId: 'A' }, traversals: [] };
			expect(() => Route.build({ ...ok, totalCost: -1 })).toThrow(RangeError);
			expect(() => Route.build({ ...ok, totalCost: Number.NaN })).toThrow(RangeError);
			expect(() => Route.build({ ...ok, totalCost: Infinity })).toThrow(RangeError);
		});
	});
});

describe('Route.toGeoJson', () => {
	it('returns a LineString feature MapLibre can draw', () => {
		const route = build(lineGraph(), ['A', 'B', 'C']);
		const feature = route.toGeoJson();
		expect(feature.type).toBe('Feature');
		expect(feature.geometry.type).toBe('LineString');
		expect(feature.geometry.coordinates).toEqual(route.coordinates.map((p) => [...p]));
		expect(feature.properties).toEqual({
			mode: 'shortest',
			totalDistanceM: route.totalDistanceM,
			estimatedWalkTimeS: route.estimatedWalkTimeS,
			stairSegmentCount: 1,
			unverifiedAccessibilityDistanceM: route.unverifiedAccessibilityDistanceM
		});
	});

	it('returns fresh, mutable positions that do not alias the frozen Route', () => {
		const route = build(lineGraph(), ['A', 'B']);
		const feature = route.toGeoJson();
		feature.geometry.coordinates[0][0] = 0;
		expect(route.coordinates[0][0]).not.toBe(0);
	});

	it('emits two positions for a zero-length route so the LineString stays valid', () => {
		const g = lineGraph();
		const route = Route.build({
			mode: 'shortest',
			origin: { nodeId: 'A' },
			destination: { nodeId: 'A' },
			originLocation: g.getNode('A')!.location,
			traversals: [],
			totalCost: 0
		});
		const coords = route.toGeoJson().geometry.coordinates;
		expect(coords).toHaveLength(2);
		expect(coords[0]).toEqual(coords[1]);
	});
});
