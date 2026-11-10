import { describe, expect, it } from 'vitest';
import { applyCorrections, type CampusCorrections } from './CampusCorrections';
import { CampusRepository } from './CampusRepository';
import { MalformedDataError } from './errors';
import { OsmCampusDataSource } from './OsmCampusDataSource';
import { OsmCampusTransformer, type OsmData, type OsmElement } from './OsmCampusTransformer';
import { describeDisconnectedComponents, findConnectedComponents } from './topology';
import type { RawCampusData } from './types';

/*
 * Synthetic Overpass export (invented coordinates near 0,0; not UTEP geometry).
 * 1 m of latitude is about 0.000009 degrees.
 *
 *   West path:  1 --- 2 --- 3          (footway, untagged)
 *                     |
 *               4 (steps 2-4, wheelchair=yes tag is ignored for steps)
 *   East path:  5 --- 6                (footway, wheelchair=yes), 5 is 2 m east of 3 but
 *                                      shares no node with the west path
 *   Hall: building way 100 around 10-13; entrance node 13 is ON the west path (node 3's
 *   way continues to 13). Annex: building way 101 with no entrance.
 */
const M = 0.000009;
const node = (id: number, xM: number, yM: number, tags?: Record<string, string>): OsmElement => ({
	type: 'node',
	id,
	lat: yM * M,
	lon: xM * M,
	...(tags ? { tags } : {})
});
const way = (id: number, nodes: number[], tags: Record<string, string>): OsmElement => ({
	type: 'way',
	id,
	nodes,
	tags
});

function makeOsm(): OsmData {
	return {
		elements: [
			way(1, [1, 2, 3, 13], { highway: 'footway' }),
			way(2, [2, 4], { highway: 'steps', wheelchair: 'yes' }),
			way(3, [5, 6], { highway: 'footway', wheelchair: 'yes', incline: '5%' }),
			way(4, [6, 7], { highway: 'footway', wheelchair: 'limited' }),
			way(5, [7, 8], { highway: 'service' }),
			way(100, [10, 11, 12, 13, 10], { building: 'yes', name: 'Test Hall' }),
			way(101, [20, 21, 22, 23, 20], { building: 'yes', name: 'Test Annex' }),
			way(102, [30, 31, 32, 33, 30], { building: 'yes' }),
			node(1, 0, 0),
			node(2, 50, 0),
			node(3, 100, 0),
			node(4, 50, -30),
			node(5, 102, 0),
			node(6, 150, 0),
			node(7, 200, 0),
			node(8, 250, 0),
			node(10, 90, 10),
			node(11, 110, 10),
			node(12, 110, 30),
			node(13, 100, 10, { entrance: 'main', wheelchair: 'yes' }),
			node(20, 0, 60),
			node(21, 20, 60),
			node(22, 20, 80),
			node(23, 0, 80),
			node(30, 300, 60),
			node(31, 320, 60),
			node(32, 320, 80),
			node(33, 300, 80)
		]
	};
}

const transform = (options = {}) => new OsmCampusTransformer(options).transform(makeOsm());
const edgeOf = (data: RawCampusData, id: string) => data.edges.find((e) => e.id === id)!;

describe('OsmCampusTransformer accessibility', () => {
	it('records untagged paths as unknown, never accessible', () => {
		expect(edgeOf(transform().data, 'w1:0').accessibility).toBe('unknown');
	});

	it('records wheelchair=yes as accessible and wheelchair=limited as inaccessible', () => {
		const { data } = transform();
		expect(edgeOf(data, 'w3:0').accessibility).toBe('accessible');
		expect(edgeOf(data, 'w4:0').accessibility).toBe('inaccessible');
	});

	it('records steps as inaccessible stairs even when tagged wheelchair=yes', () => {
		expect(edgeOf(transform().data, 'w2:0')).toMatchObject({
			hasStairs: true,
			accessibility: 'inaccessible'
		});
	});

	it('reads the incline tag as the slope', () => {
		expect(edgeOf(transform().data, 'w3:0').slopePct).toBe(5);
	});
});

describe('OsmCampusTransformer topology', () => {
	it('connects paths only where their ways share a node', () => {
		const components = findConnectedComponents(transform().data);
		const westPart = components.find((c) => c.includes('n3'))!;
		expect(westPart).toEqual(expect.arrayContaining(['n1', 'n2', 'n4', 'n13']));
		expect(westPart).not.toContain('n5'); // 2 m away, but never joined automatically
	});

	it('uses only the configured walkable highway types', () => {
		expect(transform().data.edges.some((e) => e.id === 'w5:0')).toBe(false);
		const withService = transform({ walkableHighways: ['footway', 'steps', 'service'] });
		expect(withService.data.edges.some((e) => e.id === 'w5:0')).toBe(true);
	});

	it('warns about disconnected components that hold entrances', () => {
		const { data } = transform();
		const warnings = describeDisconnectedComponents(data);
		expect(warnings[0]).toMatch(/2 disconnected components/);
	});
});

describe('OsmCampusTransformer entrances and buildings', () => {
	it('keeps a mapped entrance with its source and wheelchair status', () => {
		const entrance = transform().data.entrances.find((e) => e.id === 'en13')!;
		expect(entrance).toMatchObject({
			buildingId: 'b100',
			nodeId: 'n13',
			accessibility: 'accessible',
			source: 'mapped'
		});
	});

	it('keeps named buildings without a known entrance and does not infer one by default', () => {
		const { data, warnings } = transform();
		expect(data.buildings.map((b) => b.name)).toEqual(['Test Hall', 'Test Annex']);
		expect(data.entrances.some((e) => e.buildingId === 'b101')).toBe(false);
		expect(warnings).toContain('Building b101 (Test Annex) has no known entrance');
	});

	it('infers an unverified entrance only when fallback is enabled', () => {
		const { data } = transform({ fallbackEntranceDistanceM: 100 });
		expect(data.entrances.find((e) => e.buildingId === 'b101')).toMatchObject({
			id: 'en_b101_inferred',
			nodeId: 'n1',
			accessibility: 'unknown',
			source: 'inferred'
		});
	});

	it('warns when an entrance off the path network is connected to a nearby node', () => {
		const osm = makeOsm();
		osm.elements = osm.elements.map((el) =>
			el.type === 'way' && el.id === 1 ? { ...el, nodes: [1, 2, 3] } : el
		);
		const { data, warnings } = new OsmCampusTransformer().transform(osm);
		expect(data.entrances.find((e) => e.id === 'en13')?.nodeId).toBe('n3');
		expect(warnings.some((w) => w.includes('Entrance node 13 is not on a mapped path'))).toBe(true);
	});

	it('produces data the repository accepts', async () => {
		const repo = new CampusRepository({ load: async () => transform().data });
		await repo.loadCampusData();
		expect(repo.getEntrances('b101')).toEqual([]);
		expect(repo.getEntrances('b100')[0].source).toBe('mapped');
	});
});

describe('applyCorrections', () => {
	const corrections: CampusCorrections = {
		edges: [{ id: 'fix_gap_3_5', fromId: 'n3', toId: 'n5', note: 'Site visit: curb cut joins' }],
		entrances: [
			{
				id: 'en_annex_west',
				buildingId: 'b101',
				nodeId: 'n1',
				accessibility: 'accessible',
				note: 'Site visit: automatic door'
			}
		],
		edgeAccessibility: [
			{ edgeId: 'w1:0', accessibility: 'accessible', note: 'Site visit: smooth sidewalk' }
		]
	};

	it('adds verified connections, entrances, and accessibility without touching the input', () => {
		const original = transform().data;
		const corrected = applyCorrections(original, corrections);

		expect(findConnectedComponents(corrected)).toHaveLength(1);
		expect(edgeOf(corrected, 'fix_gap_3_5').distanceM).toBeCloseTo(2, 0);
		expect(corrected.entrances.find((e) => e.id === 'en_annex_west')?.source).toBe('verified');
		expect(edgeOf(corrected, 'w1:0').accessibility).toBe('accessible');
		expect(edgeOf(original, 'w1:0').accessibility).toBe('unknown');
		expect(original.edges.some((e) => e.id === 'fix_gap_3_5')).toBe(false);
	});

	it('requires a note on every correction', () => {
		const missingNote = {
			edges: [{ id: 'x', fromId: 'n3', toId: 'n5', note: ' ' }]
		} satisfies CampusCorrections;
		expect(() => applyCorrections(transform().data, missingNote)).toThrow(MalformedDataError);
	});

	it('rejects a correction that names an unknown edge', () => {
		const unknownEdge: CampusCorrections = {
			edgeAccessibility: [{ edgeId: 'w999:0', accessibility: 'accessible', note: 'typo' }]
		};
		expect(() => applyCorrections(transform().data, unknownEdge)).toThrow(MalformedDataError);
	});
});

describe('OsmCampusDataSource', () => {
	const files: Record<string, unknown> = {
		'/osm.json': makeOsm(),
		'/fixes.json': {
			edges: [{ id: 'fix', fromId: 'n3', toId: 'n5', note: 'Site visit' }]
		}
	};
	const fakeFetch = (async (url: string) =>
		new Response(JSON.stringify(files[url]), { status: 200 })) as unknown as typeof fetch;

	it('reports disconnected components without corrections', async () => {
		const source = new OsmCampusDataSource('/osm.json', {}, fakeFetch);
		await source.load();
		expect(source.warnings.some((w) => /disconnected components/.test(w))).toBe(true);
	});

	it('applies the separate corrections file before checking connectivity', async () => {
		const source = new OsmCampusDataSource('/osm.json', {}, fakeFetch, '/fixes.json');
		const data = await source.load();
		expect(data.edges.some((e) => e.id === 'fix')).toBe(true);
		expect(source.warnings.some((w) => /disconnected components/.test(w))).toBe(false);
	});
});
