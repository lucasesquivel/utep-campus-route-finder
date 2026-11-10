import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CampusDataSource } from './CampusDataSource';
import { CampusRepository } from './CampusRepository';
import { DataLoadError, NotFoundError } from './errors';
import { haversineM } from './geo';
import type { RawCampusData } from './types';

function makeRaw(): RawCampusData {
	return {
		nodes: [
			{ id: 'a', lat: 31.77, lng: -106.5, elevationM: 1135 },
			{ id: 'b', lat: 31.771, lng: -106.501, elevationM: 1137 },
			{ id: 'c', lat: 31.772, lng: -106.502 }
		],
		edges: [
			{ id: 'e1', fromId: 'a', toId: 'b', distanceM: 150, slopePct: 1.4, hasRamp: true },
			{
				id: 'e2',
				fromId: 'b',
				toId: 'c',
				distanceM: 150,
				hasStairs: true,
				bidirectional: false
			}
		],
		buildings: [
			{ id: 'bld1', name: 'Building One' },
			{ id: 'bld2', name: 'Building Two' }
		],
		entrances: [
			{ id: 'en1', buildingId: 'bld1', nodeId: 'a' },
			{ id: 'en2', buildingId: 'bld1', nodeId: 'b', accessibility: 'inaccessible' },
			{
				id: 'en3',
				buildingId: 'bld2',
				nodeId: 'c',
				accessibility: 'accessible',
				source: 'verified'
			}
		]
	};
}

async function loadRepo(raw: RawCampusData): Promise<CampusRepository> {
	const source: CampusDataSource = { load: async () => raw };
	const repo = new CampusRepository(source);
	await repo.loadCampusData();
	return repo;
}

describe('RoutingGraphAdapter node lookup (CG-2)', () => {
	it('returns the node location in [lng, lat] order', async () => {
		const graph = (await loadRepo(makeRaw())).getRoutingGraph();
		expect(graph.getNode('b')).toEqual({ id: 'b', location: [-106.501, 31.771] });
	});

	it('returns undefined for an unknown node', async () => {
		const graph = (await loadRepo(makeRaw())).getRoutingGraph();
		expect(graph.getNode('ghost')).toBeUndefined();
	});
});

describe('RoutingGraphAdapter traversals (CG-3)', () => {
	it('resolves a forward traversal with facts from the edge and its nodes', async () => {
		const graph = (await loadRepo(makeRaw())).getRoutingGraph();
		const [forward] = graph.getNeighbors('a');
		expect(forward).toMatchObject({
			fromNodeId: 'a',
			toNodeId: 'b',
			distanceM: 150,
			elevationChangeM: 2,
			gradePercent: 1.4
		});
		expect(forward.edge).toEqual({
			id: 'e1',
			fromNodeId: 'a',
			toNodeId: 'b',
			kind: 'path',
			geometry: [
				[-106.5, 31.77],
				[-106.501, 31.771]
			],
			hasStairs: false,
			stepCount: null,
			hasRamp: true,
			accessibility: { status: 'unknown' }
		});
	});

	it('signs grade and elevation change for the reverse direction', async () => {
		const graph = (await loadRepo(makeRaw())).getRoutingGraph();
		const reverse = graph.getNeighbors('b').find((t) => t.edge.id === 'e1:rev')!;
		expect(reverse).toMatchObject({
			fromNodeId: 'b',
			toNodeId: 'a',
			elevationChangeM: -2,
			gradePercent: -1.4
		});
		expect(reverse.edge.geometry).toEqual([
			[-106.501, 31.771],
			[-106.5, 31.77]
		]);
	});

	it('keeps each traversal in its edge stored direction', async () => {
		const graph = (await loadRepo(makeRaw())).getRoutingGraph();
		for (const id of ['a', 'b', 'c']) {
			for (const traversal of graph.getNeighbors(id)) {
				expect(traversal.fromNodeId).toBe(traversal.edge.fromNodeId);
				expect(traversal.toNodeId).toBe(traversal.edge.toNodeId);
			}
		}
	});

	it('marks stairs as kind steps and inaccessible', async () => {
		const graph = (await loadRepo(makeRaw())).getRoutingGraph();
		const stairs = graph.getNeighbors('b').find((t) => t.edge.id === 'e2')!;
		expect(stairs.edge).toMatchObject({
			kind: 'steps',
			hasStairs: true,
			accessibility: { status: 'inaccessible' }
		});
	});

	it('reports null when elevation or slope is unknown', async () => {
		const graph = (await loadRepo(makeRaw())).getRoutingGraph();
		const stairs = graph.getNeighbors('b').find((t) => t.edge.id === 'e2')!;
		expect(stairs.elevationChangeM).toBeNull();
		expect(stairs.gradePercent).toBeNull();
	});

	it('respects one-way edges', async () => {
		const graph = (await loadRepo(makeRaw())).getRoutingGraph();
		expect(graph.getNeighbors('c')).toEqual([]);
	});

	it('throws NotFoundError for an unknown node', async () => {
		const graph = (await loadRepo(makeRaw())).getRoutingGraph();
		expect(() => graph.getNeighbors('ghost')).toThrow(NotFoundError);
	});
});

describe('CampusRepository routing accessors', () => {
	it('throws DataLoadError before loading', () => {
		const repo = new CampusRepository({ load: async () => makeRaw() });
		expect(() => repo.getRoutingGraph()).toThrow(DataLoadError);
		expect(() => repo.getRoutingEntrances('bld1')).toThrow(DataLoadError);
	});

	it('passes verified entrances through with their source', async () => {
		const repo = await loadRepo(makeRaw());
		expect(repo.getRoutingEntrances('bld2')[0]).toMatchObject({
			accessibility: { status: 'accessible' },
			source: 'verified'
		});
	});

	it('returns entrances with accessibility status and unknown steps', async () => {
		const repo = await loadRepo(makeRaw());
		expect(repo.getRoutingEntrances('bld1')).toEqual([
			{
				id: 'en1',
				buildingId: 'bld1',
				nodeId: 'a',
				hasSteps: null,
				accessibility: { status: 'unknown' },
				source: 'mapped'
			},
			{
				id: 'en2',
				buildingId: 'bld1',
				nodeId: 'b',
				hasSteps: null,
				accessibility: { status: 'inaccessible' },
				source: 'mapped'
			}
		]);
	});

	it('throws NotFoundError for an unknown building', async () => {
		const repo = await loadRepo(makeRaw());
		expect(() => repo.getRoutingEntrances('ghost')).toThrow(NotFoundError);
	});

	it('reflects the latest load', async () => {
		const first = makeRaw();
		const second = makeRaw();
		second.nodes.push({ id: 'd', lat: 31.773, lng: -106.503 });
		let current = first;
		const repo = new CampusRepository({ load: async () => current });
		await repo.loadCampusData();
		expect(repo.getRoutingGraph().getNode('d')).toBeUndefined();
		current = second;
		await repo.loadCampusData();
		expect(repo.getRoutingGraph().getNode('d')).toBeDefined();
	});
});

describe('seed campus.json for routing', () => {
	// Routing's A* heuristic is the straight-line distance, so it is only admissible if no
	// edge is shorter than the straight line between its nodes.
	it('has no edge shorter than the straight line between its nodes', async () => {
		const raw = JSON.parse(readFileSync('static/data/campus.json', 'utf8')) as RawCampusData;
		const graph = (await loadRepo(raw)).getRoutingGraph();
		for (const node of raw.nodes) {
			for (const traversal of graph.getNeighbors(node.id)) {
				const [from, to] = traversal.edge.geometry;
				const straightM = haversineM(from[1], from[0], to[1], to[0]);
				expect(traversal.distanceM).toBeGreaterThanOrEqual(straightM);
			}
		}
	});
});
