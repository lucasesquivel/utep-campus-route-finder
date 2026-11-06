import { describe, it, expect } from 'bun:test';
import { CampusGraph } from './CampusGraph';
import { CampusRepository } from './CampusRepository';
import type { CampusDataSource } from './CampusDataSource';
import { DataLoadError, MalformedDataError, NotFoundError } from './errors';
import type { RawCampusData } from './types';

function makeRaw(): RawCampusData {
	return {
		nodes: [
			{ id: 'a', lat: 31.77, lng: -106.5, elevationM: 1135 },
			{ id: 'b', lat: 31.771, lng: -106.501, elevationM: 1137 },
			{ id: 'c', lat: 31.772, lng: -106.502 }
		],
		edges: [
			{ id: 'e1', fromId: 'a', toId: 'b', distanceM: 40, slopePct: 2 },
			{ id: 'e2', fromId: 'b', toId: 'c', distanceM: 30, hasStairs: true, isAccessible: false, bidirectional: false }
		],
		buildings: [
			{ id: 'bld1', name: 'Building One' },
			{ id: 'bld2', name: 'Building Two' }
		],
		entrances: [
			{ id: 'en1', buildingId: 'bld1', nodeId: 'a' },
			{ id: 'en2', buildingId: 'bld1', nodeId: 'b', isAccessible: false }
		]
	};
}

class StubSource implements CampusDataSource {
	private readonly data: RawCampusData;
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
		expect(forward).toMatchObject({ hasStairs: false, hasRamp: false, isAccessible: true, slopePct: 2 });
		expect(reverse).toMatchObject({ fromId: 'b', toId: 'a', slopePct: -2, distanceM: 40 });
	});

	it('rejects duplicate node ids', () => {
		const g = new CampusGraph();
		g.addNode({ id: 'a', lat: 0, lng: 0 });
		expect(() => g.addNode({ id: 'a', lat: 1, lng: 1 })).toThrow(MalformedDataError);
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
});

describe('entrance lookup', () => {
	it('returns a building\'s entrances with accessibility', async () => {
		const repo = await loadRepo(makeRaw());
		const entrances = repo.getEntrances('bld1');
		expect(entrances.map((e) => e.id)).toEqual(['en1', 'en2']);
		expect(entrances[1].isAccessible).toBe(false);
	});

	it('returns an empty list for a building with no entrances', async () => {
		const repo = await loadRepo(makeRaw());
		expect(repo.getEntrances('bld2')).toEqual([]);
	});

	it('throws NotFoundError for an unknown building', async () => {
		const repo = await loadRepo(makeRaw());
		expect(() => repo.getEntrances('nope')).toThrow(NotFoundError);
	});
});

describe('node/edge relationships and neighbors', () => {
	it('returns outgoing edges for a node', async () => {
		const repo = await loadRepo(makeRaw());
		expect(repo.getNeighboringPaths('b').map((e) => e.toId).sort()).toEqual(['a', 'c']);
	});

	it('respects one-way edges', async () => {
		const repo = await loadRepo(makeRaw());
		expect(repo.getNeighboringPaths('c')).toEqual([]);
	});

	it('exposes stairs and accessibility metadata', async () => {
		const repo = await loadRepo(makeRaw());
		const stairs = repo.getNeighboringPaths('b').find((e) => e.id === 'e2')!;
		expect(stairs).toMatchObject({ hasStairs: true, isAccessible: false });
	});

	it('throws NotFoundError for an unknown node', async () => {
		const repo = await loadRepo(makeRaw());
		expect(() => repo.getNeighboringPaths('zzz')).toThrow(NotFoundError);
	});

	it('does not let callers mutate internal adjacency', async () => {
		const repo = await loadRepo(makeRaw());
		repo.getNeighboringPaths('a').pop();
		expect(repo.getNeighboringPaths('a')).toHaveLength(1);
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