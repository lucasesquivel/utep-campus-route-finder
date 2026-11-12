import { describe, it, expect } from 'vitest';
import { CampusGraph } from './CampusGraph';
import { CampusRepository } from './CampusRepository';
import { applyCorrections } from './CampusCorrections';
import { describeDisconnectedComponents, findConnectedComponents } from './topology';
import { MalformedDataError } from './errors';
import type { GraphNode, LngLat, PathEdge, RawCampusData } from './types';

const node = (over: Partial<GraphNode> = {}): GraphNode => ({
	id: 'n1',
	lat: 31.77,
	lng: -106.5,
	...over
});

const edge = (over: Partial<PathEdge> = {}): PathEdge => ({
	id: 'e1',
	fromId: 'n1',
	toId: 'n2',
	distanceM: 10,
	hasStairs: false,
	hasRamp: false,
	accessibility: 'accessible',
	...over
});

/** A tiny valid dataset; each test changes one thing. */
const raw = (over: Partial<RawCampusData> = {}): RawCampusData => ({
	nodes: [
		{ id: 'n1', lat: 31.77, lng: -106.5 },
		{ id: 'n2', lat: 31.7701, lng: -106.5 }
	],
	edges: [{ id: 'e1', fromId: 'n1', toId: 'n2', distanceM: 11 }],
	buildings: [{ id: 'b1', name: 'Building One' }],
	entrances: [{ id: 'en1', buildingId: 'b1', nodeId: 'n1' }],
	...over
});

const load = (data: RawCampusData) =>
	new CampusRepository({ load: async () => data }).loadCampusData();

describe('CampusGraph validation (invalid records are rejected)', () => {
	it('rejects a node with an empty id', () => {
		expect(() => new CampusGraph([node({ id: '' })], [])).toThrow(/missing an id/);
	});

	it('rejects a latitude outside -90..90', () => {
		expect(() => new CampusGraph([node({ lat: 91 })], [])).toThrow(/invalid latitude/);
	});

	it('rejects a longitude outside -180..180', () => {
		expect(() => new CampusGraph([node({ lng: 200 })], [])).toThrow(/invalid longitude/);
	});

	it('rejects a non-numeric elevation', () => {
		expect(() => new CampusGraph([node({ elevationM: NaN })], [])).toThrow(/invalid elevation/);
	});

	it('rejects an edge with an empty id', () => {
		const nodes = [node(), node({ id: 'n2' })];
		expect(() => new CampusGraph(nodes, [edge({ id: '' })])).toThrow(/missing an id/);
	});

	it('rejects a non-numeric slope', () => {
		const nodes = [node(), node({ id: 'n2' })];
		expect(() => new CampusGraph(nodes, [edge({ slopePct: NaN })])).toThrow(/invalid slope/);
	});

	it('throws MalformedDataError (the type callers catch) for every kind of bad record', () => {
		expect(() => new CampusGraph([node({ lat: NaN })], [])).toThrow(MalformedDataError);
	});

	it('accepts boundary values: lat 90, lng -180, and a zero-length edge', () => {
		const nodes = [node({ lat: 90, lng: -180 }), node({ id: 'n2', lat: -90, lng: 180 })];
		const graph = new CampusGraph(nodes, [edge({ distanceM: 0 })]);
		expect(graph.nodeCount).toBe(2);
		expect(graph.edgeCount).toBe(1);
	});
});

describe('CampusRepository validation of buildings and entrances', () => {
	it('loads a building that has no footprint, and leaves it out of the GeoJSON', async () => {
		const repo = new CampusRepository({ load: async () => raw() });
		await repo.loadCampusData();
		expect(repo.getBuilding('b1')?.name).toBe('Building One');
		expect(repo.getBuildingsGeoJSON().features).toHaveLength(0);
	});

	it('rejects a footprint with fewer than 4 points', async () => {
		const footprint: LngLat[] = [
			[0, 0],
			[1, 0],
			[1, 1]
		];
		const data = raw({ buildings: [{ id: 'b1', name: 'B', footprint }] });
		await expect(load(data)).rejects.toThrow(/invalid footprint/);
	});

	it('rejects a footprint containing a non-numeric point', async () => {
		const footprint: LngLat[] = [
			[0, 0],
			[1, 0],
			[1, 1],
			[NaN, 0]
		];
		const data = raw({ buildings: [{ id: 'b1', name: 'B', footprint }] });
		await expect(load(data)).rejects.toThrow(/invalid footprint/);
	});

	it('rejects an invalid centroid', async () => {
		const data = raw({ buildings: [{ id: 'b1', name: 'B', centroid: [NaN, 1] }] });
		await expect(load(data)).rejects.toThrow(/invalid centroid/);
	});

	it('rejects an entrance with an unrecognized accessibility value', async () => {
		const entrances = [
			{ id: 'en1', buildingId: 'b1', nodeId: 'n1', accessibility: 'maybe' as never }
		];
		await expect(load(raw({ entrances }))).rejects.toThrow(/invalid accessibility/);
	});
});

describe('applyCorrections', () => {
	it('fills in a missing correction-edge distance from the node coordinates', () => {
		const out = applyCorrections(raw(), {
			edges: [{ id: 'e_fix', fromId: 'n2', toId: 'n1', note: 'walked it on site' }]
		});
		const added = out.edges.find((e) => e.id === 'e_fix')!;
		// 0.0001 degrees of latitude is about 11.1 m.
		expect(added.distanceM).toBeCloseTo(11.12, 1);
	});

	it('rejects a correction edge that names a node that does not exist', () => {
		expect(() =>
			applyCorrections(raw(), {
				edges: [{ id: 'e_fix', fromId: 'n1', toId: 'n_missing', note: 'site visit' }]
			})
		).toThrow(/unknown node/);
	});

	it('rejects a correction that has no note saying how it was verified', () => {
		expect(() =>
			applyCorrections(raw(), { nodes: [{ id: 'n3', lat: 31.77, lng: -106.5, note: '   ' }] })
		).toThrow(/needs a note/);
	});

	it('rejects an accessibility fix for an edge that does not exist', () => {
		expect(() =>
			applyCorrections(raw(), {
				edgeAccessibility: [{ edgeId: 'e_nope', accessibility: 'accessible', note: 'photo' }]
			})
		).toThrow(/unknown edge/);
	});

	it('marks a corrected entrance as verified and replaces the mapped one with the same id', () => {
		const out = applyCorrections(raw(), {
			entrances: [
				{ id: 'en1', buildingId: 'b1', nodeId: 'n2', accessibility: 'accessible', note: 'visited' }
			]
		});
		expect(out.entrances).toHaveLength(1);
		expect(out.entrances[0]).toMatchObject({ nodeId: 'n2', source: 'verified' });
	});

	it('does not modify the data it was given', () => {
		const input = raw();
		const before = JSON.stringify(input);
		applyCorrections(input, {
			edgeAccessibility: [{ edgeId: 'e1', accessibility: 'inaccessible', note: 'photo' }]
		});
		expect(JSON.stringify(input)).toBe(before);
	});
});

describe('topology: disconnected parts of the path network', () => {
	/** A main 2-node component plus `count` isolated nodes, each holding one entrance. */
	function withIslands(count: number): RawCampusData {
		const base = raw();
		const nodes = [...base.nodes];
		const buildings = [...base.buildings];
		const entrances = [...base.entrances];
		for (let i = 0; i < count; i++) {
			nodes.push({ id: `iso${i}`, lat: 31.8, lng: -106.5 + i * 0.001 });
			buildings.push({ id: `bi${i}`, name: `Island ${i}` });
			entrances.push({ id: `eni${i}`, buildingId: `bi${i}`, nodeId: `iso${i}` });
		}
		return { ...base, nodes, buildings, entrances };
	}

	it('finds nothing to warn about when the network is one piece', () => {
		expect(describeDisconnectedComponents(raw())).toEqual([]);
	});

	it('lists the largest component first', () => {
		const sizes = findConnectedComponents(withIslands(3)).map((c) => c.length);
		expect(sizes).toEqual([2, 1, 1, 1]);
	});

	it('names each disconnected component that holds an entrance', () => {
		const warnings = describeDisconnectedComponents(withIslands(2));
		expect(warnings[0]).toMatch(/3 disconnected components/);
		expect(warnings.some((w) => w.includes('Island 0 (eni0)'))).toBe(true);
		expect(warnings.some((w) => w.includes('Island 1 (eni1)'))).toBe(true);
	});

	it('summarizes instead of listing once there are more than 25 such components', () => {
		const warnings = describeDisconnectedComponents(withIslands(28));
		const listed = warnings.filter((w) => w.startsWith('Disconnected component of'));
		expect(listed).toHaveLength(25);
		expect(warnings.length).toBe(listed.length + 2);
	});
});
