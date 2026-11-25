import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ELEVATION_FILE_FORMAT, ElevationDataset, type ElevationFile } from './ElevationDataset';
import { MalformedDataError } from './errors';
import { OsmCampusTransformer, type OsmData } from './OsmCampusTransformer';

// Synthetic path 1 - 2 - 3 (invented coordinates near 0,0), about 111 m per segment.
const osm: OsmData = {
	elements: [
		{ type: 'way', id: 1, nodes: [1, 2, 3], tags: { highway: 'footway' } },
		{ type: 'node', id: 1, lat: 0, lon: 0 },
		{ type: 'node', id: 2, lat: 0.001, lon: 0 },
		{ type: 'node', id: 3, lat: 0.002, lon: 0 }
	]
};

function makeFile(): ElevationFile {
	return {
		format: ELEVATION_FILE_FORMAT,
		source: { dataset: 'test' },
		elevationsM: { '1': 100, '2': 102, '3': 110 },
		slopeIssues: { 'w1:1': ['steep-needs-validation'] }
	};
}

const transform = (dataset: ElevationDataset, deriveSlopes?: boolean) =>
	new OsmCampusTransformer(dataset.transformOptions(deriveSlopes)).transform(osm).data;

describe('ElevationDataset', () => {
	it('looks up elevations by OSM node id and slope issues by segment id', () => {
		const dataset = new ElevationDataset(makeFile());
		expect(dataset.nodeCount).toBe(3);
		expect(dataset.elevationOf(2)).toBe(102);
		expect(dataset.elevationOf(99)).toBeUndefined();
		expect(dataset.slopeIssuesOf('w1:1')).toEqual(['steep-needs-validation']);
		expect(dataset.isSlopeReliable('w1:0')).toBe(true);
	});

	it('rejects a file with the wrong format, a bad elevation, or an unknown issue', () => {
		expect(() => new ElevationDataset({ ...makeFile(), format: 'x' } as never)).toThrow(
			MalformedDataError
		);
		expect(() => new ElevationDataset({ ...makeFile(), elevationsM: { '1': Number.NaN } })).toThrow(
			MalformedDataError
		);
		expect(
			() => new ElevationDataset({ ...makeFile(), slopeIssues: { 'w1:0': ['guess'] } } as never)
		).toThrow(MalformedDataError);
	});

	it('cannot be modified after construction', () => {
		const dataset = new ElevationDataset(makeFile());
		expect(Object.isFrozen(dataset)).toBe(true);
		expect(() => (dataset.slopeIssuesOf('w1:1') as string[]).push('structure')).toThrow(TypeError);
	});
});

describe('elevation in the transformer', () => {
	it('records node elevations but derives no slopes by default', () => {
		const data = transform(new ElevationDataset(makeFile()));
		expect(data.nodes.map((n) => n.elevationM)).toEqual([100, 102, 110]);
		expect(data.edges.every((e) => e.slopePct === undefined)).toBe(true);
	});

	it('derives slopes only for reliable segments once enabled', () => {
		const data = transform(new ElevationDataset(makeFile()), true);
		const first = data.edges.find((e) => e.id === 'w1:0')!;
		const flagged = data.edges.find((e) => e.id === 'w1:1')!;
		expect(first.slopePct).toBeCloseTo((2 / first.distanceM) * 100, 2);
		expect(flagged.slopePct).toBeUndefined();
	});
});

describe('preprocessed UTEP elevation file', () => {
	const file = JSON.parse(
		readFileSync('static/data/campus-elevation.json', 'utf8')
	) as ElevationFile;
	const dataset = new ElevationDataset(file);
	const campus = new OsmCampusTransformer(dataset.transformOptions()).transform(
		JSON.parse(readFileSync('static/data/campus-osm.json', 'utf8')) as OsmData
	).data;

	it('has a plausible elevation for every path-network node', () => {
		const elevations = campus.nodes.map((n) => n.elevationM);
		expect(elevations.every((z) => z !== undefined && z > 1100 && z < 1250)).toBe(true);
	});

	it('flags only segments that exist, and flags footbridges as structures', () => {
		const segmentIds = new Set(campus.edges.map((e) => e.id));
		expect(Object.keys(file.slopeIssues).every((id) => segmentIds.has(id))).toBe(true);
		expect(dataset.slopeIssuesOf('w1501274253:0')).toContain('structure');
	});

	it('keeps slopes out of the campus graph until they are validated', () => {
		expect(campus.edges.every((e) => e.slopePct === undefined)).toBe(true);
	});
});
