import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CampusRepository, DataLoadError, NotFoundError } from '../campusdata';
import type { CampusDataSource } from '../campusdata/CampusDataSource';
import type { RawCampusData } from '../campusdata/types';
import {
	AdaRouteStrategy,
	EasyRouteStrategy,
	RouteEngine,
	RouteRequestError,
	ShortestRouteStrategy,
	type RouteEndpoint,
	type RouteMode,
	type RouteResult
} from '../routing';

/**
 * Integration tests: Campus Data (real seed file, real CampusRepository) feeding Routing
 * (real RouteEngine and all three strategies). Nothing is mocked, so these tests fail if
 * the data model and the routing code stop agreeing on shape or meaning.
 *
 * Expected values come from the hand-checked seed graph in static/data/campus.json.
 */

const MODES: readonly RouteMode[] = ['shortest', 'easy', 'ada'];

const seedSource: CampusDataSource = {
	load: async () => JSON.parse(readFileSync('static/data/campus.json', 'utf8')) as RawCampusData
};

async function setup() {
	const repo = new CampusRepository(seedSource);
	await repo.loadCampusData();
	const engine = new RouteEngine(repo.getRoutingGraph(), [
		new ShortestRouteStrategy(),
		new EasyRouteStrategy(),
		new AdaRouteStrategy()
	]);
	return { repo, engine };
}

/** One endpoint per entrance of a building, the way the Controller will build them. */
function endpointsFor(repo: CampusRepository, buildingId: string): RouteEndpoint[] {
	return repo.getRoutingEntrances(buildingId).map((entrance) => ({
		nodeId: entrance.nodeId,
		entrance
	}));
}

function route(
	ctx: Awaited<ReturnType<typeof setup>>,
	mode: RouteMode,
	from: string,
	to: string
): RouteResult {
	return ctx.engine.calculateRoute({
		mode,
		origins: endpointsFor(ctx.repo, from),
		destinations: endpointsFor(ctx.repo, to)
	});
}

function expectFound(result: RouteResult) {
	expect(result.status).toBe('found');
	if (result.status !== 'found') throw new Error('expected a found route');
	return result.route;
}

describe('Routing + Campus Data: wiring', () => {
	it('builds a RouteEngine from the repository graph with all three modes', async () => {
		const { engine } = await setup();
		expect(engine.supportedModes()).toEqual(['shortest', 'easy', 'ada']);
	});

	it('refuses to hand a routing graph out before data is loaded', () => {
		const repo = new CampusRepository(seedSource);
		expect(() => repo.getRoutingGraph()).toThrow(DataLoadError);
	});

	it('throws NotFoundError when asked for the entrances of an unknown building', async () => {
		const { repo } = await setup();
		expect(() => repo.getRoutingEntrances('b_nope')).toThrow(NotFoundError);
	});
});

describe('Routing + Campus Data: Union Building to Engineering Building', () => {
	it('shortest mode takes the stairs to the side entrance', async () => {
		const ctx = await setup();
		const r = expectFound(route(ctx, 'shortest', 'b_union', 'b_eng'));
		expect(r.nodeIds).toEqual(['n_union', 'n_plaza', 'n_walk_w', 'n_stairs_base', 'n_stairs_top']);
		expect(r.totalDistanceM).toBeCloseTo(191.3, 1);
		expect(r.stairSegmentCount).toBe(1);
		expect(r.destination.entrance?.id).toBe('en_eng_side');
	});

	it('easy mode keeps the same corridor but swaps the stairs for the stair-free hill path', async () => {
		const ctx = await setup();
		const r = expectFound(route(ctx, 'easy', 'b_union', 'b_eng'));
		const edgeIds = r.traversals.map((t) => t.edge.id);
		expect(edgeIds).toContain('e_hill');
		expect(edgeIds).not.toContain('e_stairs');
		expect(r.stairSegmentCount).toBe(0);
		// Easy trades a little distance for ease, never less than Shortest.
		expect(r.totalDistanceM).toBeCloseTo(192.8, 1);
	});

	it('ada mode avoids the stairs, the inaccessible side entrance and takes the ramp', async () => {
		const ctx = await setup();
		const r = expectFound(route(ctx, 'ada', 'b_union', 'b_eng'));
		expect(r.nodeIds).toEqual(['n_union', 'n_plaza', 'n_ramp_a', 'n_ramp_b', 'n_eng_door']);
		expect(r.totalDistanceM).toBeCloseTo(250.2, 1);
		expect(r.stairSegmentCount).toBe(0);
		expect(r.destination.entrance?.id).toBe('en_eng_main');
		for (const t of r.traversals) {
			expect(t.edge.accessibility.status).not.toBe('inaccessible');
		}
	});

	it('ada mode on the way back also avoids the stairs', async () => {
		const ctx = await setup();
		const r = expectFound(route(ctx, 'ada', 'b_eng', 'b_union'));
		expect(r.nodeIds).toEqual(['n_eng_door', 'n_ramp_b', 'n_ramp_a', 'n_plaza', 'n_union']);
		expect(r.origin.entrance?.id).toBe('en_eng_main');
	});
});

describe('Routing + Campus Data: accessibility data reaches Routing', () => {
	it('reports the untagged Union to Gym walk as unverified in ada mode', async () => {
		const ctx = await setup();
		const r = expectFound(route(ctx, 'ada', 'b_union', 'b_gym'));
		expect(r.nodeIds).toEqual(['n_union', 'n_gym']);
		expect(r.unverifiedAccessibilityDistanceM).toBeCloseTo(72.1, 1);
	});

	it('reports zero unverified distance on a fully verified route', async () => {
		const ctx = await setup();
		const r = expectFound(route(ctx, 'ada', 'b_library', 'b_sci'));
		expect(r.unverifiedAccessibilityDistanceM).toBe(0);
	});
});

describe('Routing + Campus Data: no-route and bad requests', () => {
	it.each(MODES)('%s mode: the disconnected Remote Annex is UNREACHABLE', async (mode) => {
		const ctx = await setup();
		expect(route(ctx, mode, 'b_union', 'b_annex')).toEqual({
			status: 'no-route',
			mode,
			reason: 'UNREACHABLE'
		});
	});

	it('returns a zero-length route when origin and destination are the same building', async () => {
		const ctx = await setup();
		const r = expectFound(route(ctx, 'shortest', 'b_union', 'b_union'));
		expect(r.totalDistanceM).toBe(0);
		expect(r.traversals).toHaveLength(0);
	});

	it('rejects an endpoint that is not a node in the campus graph', async () => {
		const { repo, engine } = await setup();
		const request = {
			mode: 'shortest' as const,
			origins: [{ nodeId: 'n_nowhere' }],
			destinations: endpointsFor(repo, 'b_eng')
		};
		expect(() => engine.calculateRoute(request)).toThrow(RouteRequestError);
		try {
			engine.calculateRoute(request);
		} catch (err) {
			expect((err as RouteRequestError).code).toBe('UNKNOWN_NODE');
		}
	});

	it('rejects a request with no origins', async () => {
		const { repo, engine } = await setup();
		try {
			engine.calculateRoute({
				mode: 'shortest',
				origins: [],
				destinations: endpointsFor(repo, 'b_eng')
			});
			expect.unreachable('calculateRoute should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(RouteRequestError);
			expect((err as RouteRequestError).code).toBe('EMPTY_ORIGINS');
		}
	});
});

describe('Routing + Campus Data: route output matches the campus graph', () => {
	it('route coordinates are exactly the [lng, lat] of each node on the path', async () => {
		const ctx = await setup();
		const r = expectFound(route(ctx, 'ada', 'b_union', 'b_eng'));
		expect(r.coordinates).toHaveLength(r.nodeIds.length);
		r.nodeIds.forEach((id, i) => {
			const node = ctx.repo.getGraph().getNode(id)!;
			expect(r.coordinates[i]).toEqual([node.lng, node.lat]);
		});
	});

	it('total distance equals the sum of the stored edge distances', async () => {
		const ctx = await setup();
		const r = expectFound(route(ctx, 'ada', 'b_union', 'b_eng'));
		const sum = r.traversals.reduce((acc, t) => acc + t.distanceM, 0);
		expect(r.totalDistanceM).toBeCloseTo(sum, 6);
	});

	it('exports a GeoJSON LineString carrying the route summary', async () => {
		const ctx = await setup();
		const r = expectFound(route(ctx, 'easy', 'b_union', 'b_eng'));
		const feature = r.toGeoJson();
		expect(feature.type).toBe('Feature');
		expect(feature.geometry.type).toBe('LineString');
		expect(feature.properties.mode).toBe('easy');
		expect(feature.properties.totalDistanceM).toBeCloseTo(r.totalDistanceM, 6);
	});

	it('returns immutable routes', async () => {
		const ctx = await setup();
		const r = expectFound(route(ctx, 'shortest', 'b_union', 'b_eng'));
		expect(Object.isFrozen(r)).toBe(true);
		expect(Object.isFrozen(r.nodeIds)).toBe(true);
	});
});

describe('Routing + Campus Data: invariants over every building pair', () => {
	it('holds for all ordered pairs of seed buildings', async () => {
		const ctx = await setup();
		const ids = ctx.repo.getBuildings().map((b) => b.id);
		let found = 0;
		let unreachable = 0;
		const EPS = 1e-6;

		for (const from of ids) {
			for (const to of ids) {
				if (from === to) continue;
				const shortest = route(ctx, 'shortest', from, to);
				const easy = route(ctx, 'easy', from, to);
				const ada = route(ctx, 'ada', from, to);

				if (shortest.status === 'no-route') {
					// Only the disconnected annex may be unreachable, in every mode.
					unreachable++;
					expect([from, to]).toContain('b_annex');
					expect(shortest.reason).toBe('UNREACHABLE');
					expect(easy.status).toBe('no-route');
					expect(ada.status).toBe('no-route');
					continue;
				}

				found++;
				// Easy forbids nothing, so it finds a route whenever Shortest does.
				const e = expectFound(easy);
				// No mode can beat Shortest's distance.
				expect(e.totalDistanceM).toBeGreaterThanOrEqual(shortest.route.totalDistanceM - EPS);
				if (ada.status === 'found') {
					expect(ada.route.totalDistanceM).toBeGreaterThanOrEqual(
						shortest.route.totalDistanceM - EPS
					);
					expect(ada.route.stairSegmentCount).toBe(0);
				}
				// Walking distance is the same in both directions (reverse edges are generated).
				const back = expectFound(route(ctx, 'shortest', to, from));
				expect(back.totalDistanceM).toBeCloseTo(shortest.route.totalDistanceM, 6);
			}
		}

		// Guard against the loop passing vacuously: 7 buildings = 42 ordered pairs,
		// 12 of which involve the annex.
		expect(found).toBe(30);
		expect(unreachable).toBe(12);
	});
});
