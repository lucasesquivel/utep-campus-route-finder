import { describe, expect, it } from 'vitest';
import { CampusGraph } from './CampusGraph';
import { CampusRepository } from './CampusRepository';
import type { CampusDataSource } from './CampusDataSource';
import { DataLoadError, MalformedDataError, NotFoundError } from './errors';
import type { PathEdge, RawCampusData } from './types';

function makeRaw(): RawCampusData {
	return {
		nodes: [
			{ id: 'a', lat: 31.77, lng: -106.5, elevationM: 1135 },
			{ id: 'b', lat: 31.771, lng: -106.501, elevationM: 1137 },
			{ id: 'c', lat: 31.772, lng: -106.502 }
		],
		edges: [
			{ id: 'e1', fromId: 'a', toId: 'b', distanceM: 40, slopePct: 2 },
			{ id: 'e2', fromId: 'b', toId: 'c', distanceM: 30, hasStairs: true, bidirectional: false }
		],
		buildings: [
			{
				id: 'bld1',
				name: 'Building One',
				footprint: [
					[-106.5, 31.77],
					[-106.4999, 31.77],
					[-106.4999, 31.7701],
					[-106.5, 31.77]
				]
			},
			{ id: 'bld2', name: 'Building Two' }
		],
		entrances: [
			{ id: 'en1', buildingId: 'bld1', nodeId: 'a' },
			{ id: 'en2', buildingId: 'bld1', nodeId: 'b', accessibility: 'inaccessible' }
		]
	};
}

class StubSource implements CampusDataSource {
	data: RawCampusData;
	constructor(data: RawCampusData) {
		this.data = data;
	}
	async load(): Promise<RawCampusData> {
		return this.data;
	}
}

async function loadRepo(raw: RawCampusData): Promise<CampusRepository> {
	const repo = new CampusRepository(new StubSource(raw));
	await repo.loadCampusData();
	return repo;
}

function edge(overrides: Partial<PathEdge> = {}): PathEdge {
	return {
		id: 'e',
		fromId: 'a',
		toId: 'b',
		distanceM: 10,
		hasStairs: false,
		hasRamp: false,
		accessibility: 'unknown',
		...overrides
	};
}

const twoNodes = [
	{ id: 'a', lat: 0, lng: 0 },
	{ id: 'b', lat: 0, lng: 0.001 }
];

describe('graph construction', () => {
	it('builds nodes and edges, adding reverse edges for bidirectional paths', async () => {
		const graph = (await loadRepo(makeRaw())).getGraph();
		expect(graph.nodeCount).toBe(3);
		expect(graph.edgeCount).toBe(3); // e1, e1:rev, e2 (one-way)
	});

	it('applies defaults and negates slope on the reverse edge', async () => {
		const repo = await loadRepo(makeRaw());
		const forward = repo.getNeighboringPaths('a')[0];
		const reverse = repo.getNeighboringPaths('b').find((e) => e.id === 'e1:rev')!;
		expect(forward).toMatchObject({
			hasStairs: false,
			hasRamp: false,
			accessibility: 'unknown',
			slopePct: 2
		});
		expect(reverse).toMatchObject({ fromId: 'b', toId: 'a', slopePct: -2, distanceM: 40 });
	});

	it('rejects duplicate node ids', () => {
		expect(() => new CampusGraph([twoNodes[0], { ...twoNodes[0] }], [])).toThrow(
			MalformedDataError
		);
	});

	it('rejects duplicate edge ids', () => {
		expect(() => new CampusGraph(twoNodes, [edge(), edge()])).toThrow(MalformedDataError);
	});
});

describe('accessibility states', () => {
	it('defaults an untagged path to unknown, never accessible', async () => {
		const repo = await loadRepo(makeRaw());
		expect(repo.getNeighboringPaths('a')[0].accessibility).toBe('unknown');
	});

	it('defaults stairs to inaccessible', async () => {
		const repo = await loadRepo(makeRaw());
		const stairs = repo.getNeighboringPaths('b').find((e) => e.id === 'e2')!;
		expect(stairs).toMatchObject({ hasStairs: true, accessibility: 'inaccessible' });
	});

	it('keeps an explicit status on both directions of a path', async () => {
		const raw = makeRaw();
		raw.edges[0].accessibility = 'accessible';
		const repo = await loadRepo(raw);
		const reverse = repo.getNeighboringPaths('b').find((e) => e.id === 'e1:rev')!;
		expect(repo.getNeighboringPaths('a')[0].accessibility).toBe('accessible');
		expect(reverse.accessibility).toBe('accessible');
	});

	it('rejects stairs marked accessible', async () => {
		const raw = makeRaw();
		raw.edges[1].accessibility = 'accessible';
		await expect(loadRepo(raw)).rejects.toThrow(MalformedDataError);
	});

	it('rejects an unrecognized accessibility value', async () => {
		const raw = makeRaw();
		(raw.edges[0] as { accessibility: string }).accessibility = 'yes';
		await expect(loadRepo(raw)).rejects.toThrow(MalformedDataError);
	});

	it('rejects the removed isAccessible field so stale files are migrated', async () => {
		const raw = makeRaw();
		Object.assign(raw.edges[0], { isAccessible: true });
		await expect(loadRepo(raw)).rejects.toThrow(/isAccessible/);
	});

	it('defaults an untagged entrance to unknown and mapped', async () => {
		const repo = await loadRepo(makeRaw());
		expect(repo.getEntrances('bld1')[0]).toMatchObject({
			accessibility: 'unknown',
			source: 'mapped'
		});
	});

	it('accepts an inferred entrance only with unknown accessibility', async () => {
		const ok = makeRaw();
		ok.entrances.push({ id: 'en3', buildingId: 'bld2', nodeId: 'c', source: 'inferred' });
		expect((await loadRepo(ok)).getEntrances('bld2')[0]).toMatchObject({
			source: 'inferred',
			accessibility: 'unknown'
		});

		const bad = makeRaw();
		bad.entrances.push({
			id: 'en3',
			buildingId: 'bld2',
			nodeId: 'c',
			source: 'inferred',
			accessibility: 'accessible'
		});
		await expect(loadRepo(bad)).rejects.toThrow(MalformedDataError);
	});

	it('rejects an unrecognized entrance source', async () => {
		const raw = makeRaw();
		(raw.entrances[0] as { source?: string }).source = 'guessed';
		await expect(loadRepo(raw)).rejects.toThrow(MalformedDataError);
	});
});

describe('building lookup', () => {
	it('finds a building by id', async () => {
		const repo = await loadRepo(makeRaw());
		expect(repo.getBuilding('bld1')?.name).toBe('Building One');
	});

	it('returns undefined for an unknown building', async () => {
		const repo = await loadRepo(makeRaw());
		expect(repo.getBuilding('nope')).toBeUndefined();
	});

	it('keeps a building that has no known entrance', async () => {
		const repo = await loadRepo(makeRaw());
		expect(repo.getBuilding('bld2')).toBeDefined();
		expect(repo.getEntrances('bld2')).toEqual([]);
	});
});

describe('entrance lookup', () => {
	it("returns a building's entrances with accessibility", async () => {
		const repo = await loadRepo(makeRaw());
		const entrances = repo.getEntrances('bld1');
		expect(entrances.map((e) => e.id)).toEqual(['en1', 'en2']);
		expect(entrances[1].accessibility).toBe('inaccessible');
	});

	it('throws NotFoundError for an unknown building', async () => {
		const repo = await loadRepo(makeRaw());
		expect(() => repo.getEntrances('nope')).toThrow(NotFoundError);
	});
});

describe('node/edge relationships and neighbors', () => {
	it('returns outgoing edges for a node', async () => {
		const repo = await loadRepo(makeRaw());
		expect(
			repo
				.getNeighboringPaths('b')
				.map((e) => e.toId)
				.sort()
		).toEqual(['a', 'c']);
	});

	it('respects one-way edges', async () => {
		const repo = await loadRepo(makeRaw());
		expect(repo.getNeighboringPaths('c')).toEqual([]);
	});

	it('throws NotFoundError for an unknown node', async () => {
		const repo = await loadRepo(makeRaw());
		expect(() => repo.getNeighboringPaths('zzz')).toThrow(NotFoundError);
	});
});

describe('immutability of the finalized graph', () => {
	it('freezes the graph object itself', async () => {
		const graph = (await loadRepo(makeRaw())).getGraph();
		expect(Object.isFrozen(graph)).toBe(true);
		expect(() => Object.assign(graph, { nodeCount: 99 })).toThrow(TypeError);
		expect(graph.nodeCount).toBe(3);
	});

	it('has no methods for adding nodes or edges', async () => {
		const graph = (await loadRepo(makeRaw())).getGraph() as unknown as Record<string, unknown>;
		expect(graph.addNode).toBeUndefined();
		expect(graph.addEdge).toBeUndefined();
	});

	it('rejects changes to returned neighbor lists', async () => {
		const repo = await loadRepo(makeRaw());
		const paths = repo.getNeighboringPaths('a') as PathEdge[];
		expect(() => paths.pop()).toThrow(TypeError);
		expect(repo.getNeighboringPaths('a')).toHaveLength(1);
	});

	it('rejects changes to node and edge records', async () => {
		const graph = (await loadRepo(makeRaw())).getGraph();
		const node = graph.getNode('a')!;
		const path = graph.getNeighbors('a')[0];
		expect(() => Object.assign(node, { lat: 0 })).toThrow(TypeError);
		expect(() => Object.assign(path, { accessibility: 'accessible' })).toThrow(TypeError);
		expect(graph.getNode('a')!.lat).toBe(31.77);
		expect(graph.getNeighbors('a')[0].accessibility).toBe('unknown');
	});

	it('rejects changes to the node list', async () => {
		const graph = (await loadRepo(makeRaw())).getGraph();
		expect(() => (graph.getNodes() as unknown[]).push({})).toThrow(TypeError);
	});

	it('copies input records so later changes to them do not leak in', () => {
		const nodes = twoNodes.map((n) => ({ ...n }));
		const edges = [edge()];
		const graph = new CampusGraph(nodes, edges);
		nodes[0].lat = 45;
		Object.assign(edges[0], { distanceM: 999 });
		expect(graph.getNode('a')!.lat).toBe(0);
		expect(graph.getNeighbors('a')[0].distanceM).toBe(10);
	});

	it('rejects changes to buildings, their footprints, and entrances', async () => {
		const repo = await loadRepo(makeRaw());
		const building = repo.getBuilding('bld1')!;
		const entrance = repo.getEntrances('bld1')[0];
		expect(() => Object.assign(building, { name: 'X' })).toThrow(TypeError);
		expect(() => (building.entranceIds as string[]).push('x')).toThrow(TypeError);
		expect(() => (building.footprint as unknown[]).push([0, 0])).toThrow(TypeError);
		expect(() => Object.assign(building.footprint![0], { 0: 0 })).toThrow(TypeError);
		expect(() => Object.assign(entrance, { accessibility: 'accessible' })).toThrow(TypeError);
	});
});

describe('malformed or missing data', () => {
	it('rejects an edge that references a missing node', async () => {
		const raw = makeRaw();
		raw.edges.push({ id: 'bad', fromId: 'a', toId: 'ghost', distanceM: 5 });
		await expect(loadRepo(raw)).rejects.toThrow(MalformedDataError);
	});

	it('rejects invalid coordinates', async () => {
		const raw = makeRaw();
		raw.nodes[0].lat = Number.NaN;
		await expect(loadRepo(raw)).rejects.toThrow(MalformedDataError);
	});

	it('rejects a negative edge distance', async () => {
		const raw = makeRaw();
		raw.edges[0].distanceM = -1;
		await expect(loadRepo(raw)).rejects.toThrow(MalformedDataError);
	});

	it('rejects an entrance pointing at an unknown building or node', async () => {
		const badBuilding = makeRaw();
		badBuilding.entrances.push({ id: 'x', buildingId: 'ghost', nodeId: 'a' });
		await expect(loadRepo(badBuilding)).rejects.toThrow(MalformedDataError);

		const badNode = makeRaw();
		badNode.entrances.push({ id: 'y', buildingId: 'bld1', nodeId: 'ghost' });
		await expect(loadRepo(badNode)).rejects.toThrow(MalformedDataError);
	});

	it('rejects data missing required arrays', async () => {
		const raw = { nodes: [], edges: [], buildings: [] } as unknown as RawCampusData;
		await expect(loadRepo(raw)).rejects.toThrow(MalformedDataError);
	});

	it('keeps the previous data when a reload fails validation', async () => {
		const source = new StubSource(makeRaw());
		const repo = new CampusRepository(source);
		await repo.loadCampusData();
		source.data = { ...makeRaw(), nodes: [] };
		await expect(repo.loadCampusData()).rejects.toThrow(MalformedDataError);
		expect(repo.getGraph().nodeCount).toBe(3);
	});

	it('wraps unexpected source failures in DataLoadError', async () => {
		const failing: CampusDataSource = {
			load: async () => {
				throw new Error('disk on fire');
			}
		};
		await expect(new CampusRepository(failing).loadCampusData()).rejects.toThrow(DataLoadError);
	});

	it('throws DataLoadError if used before loading', () => {
		const repo = new CampusRepository(new StubSource(makeRaw()));
		expect(() => repo.getGraph()).toThrow(DataLoadError);
	});
});
