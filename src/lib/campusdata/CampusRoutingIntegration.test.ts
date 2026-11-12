import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	AdaRouteStrategy,
	EasyRouteStrategy,
	RouteEngine,
	ShortestRouteStrategy,
	type CampusGraphView,
	type Route,
	type RouteEndpoint,
	type RouteMode,
	type RouteResult
} from '../routing';
import { CampusRepository } from './CampusRepository';
import type { RawCampusData } from './types';

/*
 * Integration of Campus Data with Routing's RouteEngine through the official methods
 * getRoutingGraph() and getRoutingEntrances(), on the seed data (static/data/campus.json).
 */

function readSeed(): RawCampusData {
	return JSON.parse(readFileSync('static/data/campus.json', 'utf8')) as RawCampusData;
}

async function routeBetween(
	from: string,
	to: string,
	mode: RouteMode,
	raw: RawCampusData = readSeed()
): Promise<RouteResult> {
	const repo = new CampusRepository({ load: async () => raw });
	await repo.loadCampusData();
	const graph: CampusGraphView = repo.getRoutingGraph();
	const engine = new RouteEngine(graph, [
		new ShortestRouteStrategy(),
		new EasyRouteStrategy(),
		new AdaRouteStrategy()
	]);
	const endpoints = (buildingId: string): RouteEndpoint[] =>
		repo.getRoutingEntrances(buildingId).map((entrance) => ({ nodeId: entrance.nodeId, entrance }));
	return engine.calculateRoute({ mode, origins: endpoints(from), destinations: endpoints(to) });
}

function expectFound(result: RouteResult): Route {
	if (result.status !== 'found') throw new Error(`Expected a route, got ${result.reason}`);
	return result.route;
}

const edgeIds = (route: Route) => route.traversals.map((t) => t.edge.id);

describe('successful routes', () => {
	it('Shortest takes the stairs to the nearer side entrance', async () => {
		const route = expectFound(await routeBetween('b_union', 'b_eng', 'shortest'));
		expect(edgeIds(route)).toContain('e_stairs');
		expect(route.destination.entrance?.id).toBe('en_eng_side');
		expect(route.coordinates).toHaveLength(route.nodeIds.length);
	});

	it('Easy avoids the stairs', async () => {
		const route = expectFound(await routeBetween('b_union', 'b_eng', 'easy'));
		expect(route.stairSegmentCount).toBe(0);
	});

	it('ADA uses the ramp to the accessible main entrance', async () => {
		const route = expectFound(await routeBetween('b_union', 'b_eng', 'ada'));
		expect(route.nodeIds).toEqual(['n_union', 'n_plaza', 'n_ramp_a', 'n_ramp_b', 'n_eng_door']);
		expect(route.destination.entrance?.id).toBe('en_eng_main');
		expect(route.unverifiedAccessibilityDistanceM).toBe(0);
	});

	it('ADA reports distance over paths whose accessibility is unknown', async () => {
		const route = expectFound(await routeBetween('b_gym', 'b_library', 'ada'));
		expect(edgeIds(route)).toContain('e_union_gym:rev');
		expect(route.unverifiedAccessibilityDistanceM).toBeCloseTo(72.1, 1);
	});
});

describe('unavailable routes', () => {
	it('reports the disconnected annex as unreachable in every mode', async () => {
		for (const mode of ['shortest', 'easy', 'ada'] as const) {
			expect(await routeBetween('b_union', 'b_annex', mode)).toMatchObject({
				status: 'no-route',
				reason: 'UNREACHABLE'
			});
		}
	});

	it('reports no usable destination when ADA has only inaccessible entrances', async () => {
		const raw = readSeed();
		raw.entrances = raw.entrances.map((e) =>
			e.buildingId === 'b_eng' ? { ...e, accessibility: 'inaccessible' } : e
		);
		expect(await routeBetween('b_union', 'b_eng', 'ada', raw)).toMatchObject({
			status: 'no-route',
			reason: 'NO_USABLE_DESTINATION'
		});
		expect((await routeBetween('b_union', 'b_eng', 'shortest', raw)).status).toBe('found');
	});
});
