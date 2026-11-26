import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { CampusRepository } from '../campusdata/CampusRepository';
import { ElevationDataset, type ElevationFile } from '../campusdata/ElevationDataset';
import { OsmCampusTransformer, type OsmData } from '../campusdata/OsmCampusTransformer';
import type { RawCampusData } from '../campusdata/types';
import {
	AdaRouteStrategy,
	EasyRouteStrategy,
	RouteEngine,
	ShortestRouteStrategy,
	type Route
} from '../routing';
import { EXCLUDED_BUILDING_IDS } from '../server/BuildingCatalog';

/* Checks slope handling and Easy routing on the real UTEP data (revisit counts if the data is refreshed). */

const osm = JSON.parse(readFileSync('static/data/campus-osm.json', 'utf8')) as OsmData;
const dataset = new ElevationDataset(
	JSON.parse(readFileSync('static/data/campus-elevation.json', 'utf8')) as ElevationFile
);
const transform = (derive: boolean, smooth: boolean): RawCampusData =>
	new OsmCampusTransformer({
		fallbackEntranceDistanceM: 45,
		...dataset.transformOptions(derive, smooth)
	}).transform(osm).data;

const ownSlopesOnly = transform(true, false); // only segments whose own slope is reliable
const smoothed = transform(true, true); // what the app uses
const noSlopes = transform(false, false);

const ownById = new Map(ownSlopesOnly.edges.map((e) => [e.id, e]));
const nonStairs = smoothed.edges.filter((e) => !e.hasStairs);
const newlySmoothed = smoothed.edges.filter(
	(e) => e.slopePct !== undefined && ownById.get(e.id)!.slopePct === undefined
);

describe('slope handling on the real campus data', () => {
	it('adds slopes to far more walkable segments than reliable-only slopes did', () => {
		const share = (edges: typeof nonStairs) =>
			edges.filter((e) => e.slopePct !== undefined).length / nonStairs.length;
		const ownShare = share(ownSlopesOnly.edges.filter((e) => !e.hasStairs));
		expect(ownShare).toBeLessThan(0.45); // reliable-only: about 39%
		expect(share(nonStairs)).toBeGreaterThan(0.7); // with smoothing: about 75%
		expect(newlySmoothed.length).toBeGreaterThan(1000);
	});

	it('never changes a slope that was already reliable', () => {
		for (const edge of smoothed.edges) {
			const own = ownById.get(edge.id)!.slopePct;
			if (own !== undefined) expect(edge.slopePct).toBe(own);
		}
	});

	it('keeps every smoothed grade physically plausible for a walkway (at most 15%)', () => {
		const grades = newlySmoothed.map((e) => Math.abs(e.slopePct!));
		expect(grades.every((g) => Number.isFinite(g) && g <= 15)).toBe(true);
	});

	it('gives no slope to stairs', () => {
		const baseline = new Map(noSlopes.edges.map((e) => [e.id, e.slopePct]));
		for (const edge of smoothed.edges.filter((e) => e.hasStairs)) {
			expect(edge.slopePct).toBe(baseline.get(edge.id));
		}
	});

	it('never slopes segments that are bridges, tunnels or other structures', () => {
		const structures = Object.entries(
			JSON.parse(readFileSync('static/data/campus-elevation.json', 'utf8')).slopeIssues as Record<
				string,
				string[]
			>
		)
			.filter(([, issues]) => issues.includes('structure'))
			.map(([id]) => id);
		const byId = new Map(smoothed.edges.map((e) => [e.id, e]));
		expect(structures.length).toBeGreaterThan(0);
		for (const id of structures) expect(byId.get(id)?.slopePct).toBeUndefined();
	});

	it('signs each reverse direction opposite to its forward direction', async () => {
		const repo = new CampusRepository({ load: async () => structuredClone(smoothed) });
		await repo.loadCampusData();
		const graph = repo.getGraph();
		const forward = new Map<string, number | undefined>();
		const reverse = new Map<string, number | undefined>();
		for (const node of graph.getNodes()) {
			for (const edge of graph.getNeighbors(node.id)) {
				if (edge.id.endsWith(':rev')) reverse.set(edge.id.slice(0, -4), edge.slopePct);
				else forward.set(edge.id, edge.slopePct);
			}
		}
		let checked = 0;
		for (const [id, slope] of forward) {
			if (!reverse.has(id)) continue;
			if (slope === undefined) expect(reverse.get(id)).toBeUndefined();
			else expect(reverse.get(id)).toBeCloseTo(-slope, 5);
			checked++;
		}
		expect(checked).toBeGreaterThan(1000);
	});
});

describe('Easiest routing with slopes, on the real campus', () => {
	let repo: CampusRepository;
	let engine: RouteEngine;
	const easy = new EasyRouteStrategy();
	let sample: string[];

	beforeAll(async () => {
		repo = new CampusRepository({ load: async () => structuredClone(smoothed) });
		await repo.loadCampusData();
		engine = new RouteEngine(repo.getRoutingGraph(), [
			new ShortestRouteStrategy(),
			new EasyRouteStrategy(),
			new AdaRouteStrategy()
		]);
		const ids = repo
			.getBuildings()
			.filter((b) => !EXCLUDED_BUILDING_IDS.has(b.id) && repo.getEntrances(b.id).length > 0)
			.map((b) => b.id)
			.sort();
		const step = Math.max(1, Math.floor(ids.length / 14));
		sample = ids.filter((_, i) => i % step === 0).slice(0, 14);
	});

	function route(mode: 'shortest' | 'easy', from: string, to: string): Route | undefined {
		const result = engine.calculateRoute({
			mode,
			origins: repo.getRoutingEntrances(from),
			destinations: repo.getRoutingEntrances(to)
		});
		return result.status === 'found' ? result.route : undefined;
	}

	function pairs() {
		const out: { from: string; to: string; shortest: Route; easyRoute: Route }[] = [];
		for (const from of sample) {
			for (const to of sample) {
				if (from >= to) continue;
				const shortest = route('shortest', from, to);
				const easyRoute = route('easy', from, to);
				if (shortest && easyRoute) out.push({ from, to, shortest, easyRoute });
			}
		}
		return out;
	}

	it('finds an Easy route wherever it finds a Shortest route', () => {
		for (const from of sample) {
			for (const to of sample) {
				if (from >= to) continue;
				expect(route('easy', from, to) !== undefined).toBe(
					route('shortest', from, to) !== undefined
				);
			}
		}
	});

	it('is never worse than the shortest path by the Easy cost, and never shorter in distance', () => {
		const all = pairs();
		expect(all.length).toBeGreaterThan(50);
		for (const { shortest, easyRoute } of all) {
			const shortestEasyCost = shortest.traversals.reduce((sum, t) => sum + easy.edgeCost(t), 0);
			expect(easyRoute.totalCost).toBeLessThanOrEqual(shortestEasyCost + 1e-6);
			expect(easyRoute.totalDistanceM).toBeGreaterThanOrEqual(shortest.totalDistanceM - 1e-6);
		}
	});

	it('takes a longer route that climbs less for at least some real building pairs', () => {
		const detours = pairs().filter(
			({ shortest, easyRoute }) =>
				easyRoute.totalDistanceM > shortest.totalDistanceM + 1 &&
				easyRoute.elevationGainM < shortest.elevationGainM - 0.5
		);
		expect(detours.length).toBeGreaterThan(0);
	});

	it('does not climb more overall than the shortest routes (summed over the sample)', () => {
		const all = pairs();
		const shortestGain = all.reduce((sum, p) => sum + p.shortest.elevationGainM, 0);
		const easyGain = all.reduce((sum, p) => sum + p.easyRoute.elevationGainM, 0);
		expect(easyGain).toBeLessThanOrEqual(shortestGain);
	});
});
