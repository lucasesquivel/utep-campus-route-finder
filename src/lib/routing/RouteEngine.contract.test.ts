import { describe, it, expect } from 'vitest';
import { RouteEngine } from './RouteEngine';
import { ShortestRouteStrategy } from './ShortestRouteStrategy';
import { FakeCampusGraph } from './testFixtures';
import type { CampusGraphView } from './campusDataView';

/**
 * Routing trusts Campus Data's two contracts: CG-2 getNode and CG-3 getNeighbors. These
 * tests check what happens when Campus Data breaks that trust, so a data bug is reported
 * loudly instead of producing a wrong route.
 */

/** a --50m-- b --50m-- c in a straight line. */
function lineGraph(): FakeCampusGraph {
	const graph = new FakeCampusGraph().addNode('a', 0, 0).addNode('b', 50, 0).addNode('c', 100, 0);
	graph.addEdge({ from: 'a', to: 'b' });
	graph.addEdge({ from: 'b', to: 'c' });
	return graph;
}

const A_TO_C = {
	mode: 'shortest' as const,
	origins: [{ nodeId: 'a' }],
	destinations: [{ nodeId: 'c' }]
};

describe('RouteEngine: Campus Data contract violations', () => {
	it('finds the route when the graph is consistent (control case)', () => {
		const engine = new RouteEngine(lineGraph(), [new ShortestRouteStrategy()]);
		const result = engine.calculateRoute(A_TO_C);
		expect(result.status).toBe('found');
	});

	it('throws a clear error when CG-3 returns a neighbor that CG-2 does not know', () => {
		const graph = lineGraph();
		const inconsistent: CampusGraphView = {
			getNode: (id) => (id === 'b' ? undefined : graph.getNode(id)),
			getNeighbors: (id) => graph.getNeighbors(id)
		};
		const engine = new RouteEngine(inconsistent, [new ShortestRouteStrategy()]);
		expect(() => engine.calculateRoute(A_TO_C)).toThrow(/unknown node b/);
	});

	it('gives the same answer twice on a frozen graph, so the search never changes the graph', () => {
		const engine = new RouteEngine(lineGraph().freeze(), [new ShortestRouteStrategy()]);
		const first = engine.calculateRoute(A_TO_C);
		const second = engine.calculateRoute(A_TO_C);
		expect(first).toEqual(second);
	});
});
