import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	AdaRouteStrategy,
	EasyRouteStrategy,
	RouteEngine,
	ShortestRouteStrategy,
	type Route,
	type RouteMode,
	type RouteResult
} from '../routing';
import { CampusRepository } from './CampusRepository';
import { OsmCampusDataSource } from './OsmCampusDataSource';

/*
 * Runs the real UTEP OpenStreetMap export (static/data/campus-osm.json, Overpass, 2026-11-10)
 * and the team's corrections file through the full pipeline: transformer, corrections,
 * repository, and Routing's RouteEngine. Counts below describe that snapshot; update them
 * when the export is refreshed. Coverage and data gaps: docs/campus-data-coverage.md.
 */

const files: Record<string, string> = {
	'/data/campus-osm.json': 'static/data/campus-osm.json',
	'/data/campus-corrections.json': 'static/data/campus-corrections.json'
};
const fileFetch = (async (url: string) =>
	new Response(readFileSync(files[url], 'utf8'), { status: 200 })) as unknown as typeof fetch;

let source: OsmCampusDataSource;
let repo: CampusRepository;
let engine: RouteEngine;

beforeAll(async () => {
	source = new OsmCampusDataSource(
		'/data/campus-osm.json',
		{},
		fileFetch,
		'/data/campus-corrections.json'
	);
	repo = new CampusRepository(source);
	await repo.loadCampusData();
	engine = new RouteEngine(repo.getRoutingGraph(), [
		new ShortestRouteStrategy(),
		new EasyRouteStrategy(),
		new AdaRouteStrategy()
	]);
});

function buildingId(name: string): string {
	const building = repo.getBuildings().find((b) => b.name === name);
	if (!building) throw new Error(`Building not found in export: ${name}`);
	return building.id;
}

function routeBetween(from: string, to: string, mode: RouteMode): RouteResult {
	const endpoints = (name: string) =>
		repo.getRoutingEntrances(buildingId(name)).map((entrance) => ({
			nodeId: entrance.nodeId,
			entrance
		}));
	return engine.calculateRoute({ mode, origins: endpoints(from), destinations: endpoints(to) });
}

function expectFound(result: RouteResult): Route {
	if (result.status !== 'found') throw new Error(`Expected a route, got ${result.reason}`);
	return result.route;
}

describe('real UTEP export: buildings and entrances', () => {
	it('keeps every named building, including ones without a known entrance', () => {
		const names = repo.getBuildings().map((b) => b.name);
		expect(names).toHaveLength(51);
		expect(names).toEqual(
			expect.arrayContaining([
				'Old Main',
				'University Library',
				'Undergraduate Learning Center',
				'Union Complex',
				'Engineering and Sciences Complex',
				'Chemistry and Computer Science'
			])
		);
		expect(repo.getEntrances(buildingId('Undergraduate Learning Center'))).toEqual([]);
	});

	it('uses only mapped entrances, all of unknown accessibility', () => {
		const entrances = repo.getBuildings().flatMap((b) => repo.getEntrances(b.id));
		expect(entrances).toHaveLength(12);
		expect(entrances.every((e) => e.source === 'mapped' && e.accessibility === 'unknown')).toBe(
			true
		);
		expect(new Set(entrances.map((e) => e.buildingId)).size).toBe(7);
	});
});

describe('real UTEP export: paths', () => {
	it('records untagged paths as unknown and every staircase as inaccessible', () => {
		const graph = repo.getGraph();
		const edges = graph.getNodes().flatMap((n) => graph.getNeighbors(n.id));
		const stairs = edges.filter((e) => e.hasStairs);
		expect(stairs.length).toBeGreaterThan(0);
		expect(stairs.every((e) => e.accessibility === 'inaccessible')).toBe(true);
		expect(edges.filter((e) => !e.hasStairs).every((e) => e.accessibility === 'unknown')).toBe(
			true
		);
	});

	it('reports the disconnected parts of the path network', () => {
		expect(source.warnings).toContain(
			'Path network has 12 disconnected components; the largest has 2699 nodes'
		);
	});
});

describe('real UTEP export: routes through RouteEngine', () => {
	it('finds Old Main to the University Library in every mode', () => {
		for (const mode of ['shortest', 'easy', 'ada'] as const) {
			const route = expectFound(routeBetween('Old Main', 'University Library', mode));
			expect(route.totalDistanceM).toBeGreaterThan(400);
			expect(route.totalDistanceM).toBeLessThan(900);
		}
	});

	it('keeps ADA off stairs where Shortest uses them, at a longer distance', () => {
		const shortest = expectFound(routeBetween('Old Main', 'Psychology', 'shortest'));
		const ada = expectFound(routeBetween('Old Main', 'Psychology', 'ada'));
		expect(shortest.stairSegmentCount).toBeGreaterThan(0);
		expect(ada.stairSegmentCount).toBe(0);
		expect(ada.totalDistanceM).toBeGreaterThan(shortest.totalDistanceM);
	});

	it('uses fewer stairs in Easy mode than in Shortest mode', () => {
		const shortest = expectFound(
			routeBetween('Sun Bowl Parking Garage (SBG)', 'Old Main', 'shortest')
		);
		const easy = expectFound(routeBetween('Sun Bowl Parking Garage (SBG)', 'Old Main', 'easy'));
		expect(easy.stairSegmentCount).toBeLessThan(shortest.stairSegmentCount);
	});

	it('reports ADA routes as unverified because no path has wheelchair data yet', () => {
		const ada = expectFound(routeBetween('Psychology', 'Health Sciences and Nursing', 'ada'));
		expect(ada.unverifiedAccessibilityDistanceM).toBeCloseTo(ada.totalDistanceM, 0);
	});
});
