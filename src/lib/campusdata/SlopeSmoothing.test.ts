import { describe, expect, it } from 'vitest';
import { CampusRepository } from './CampusRepository';
import { ELEVATION_FILE_FORMAT, ElevationDataset, type ElevationFile } from './ElevationDataset';
import { OsmCampusTransformer, type OsmData } from './OsmCampusTransformer';

/*
 * Slope smoothing test path: six nodes in a line, 5 m apart (invented coordinates near 0,0).
 *
 *   node:       1     2     3     4     5     6
 *   elevation: 100   100   100   100   100   101
 *   segment:     w1:0  w1:1  w1:2  w1:3  w1:4
 */
const M = 0.000009; // about 1 m of latitude
const ELEVATIONS = [100, 100, 100, 100, 100, 101];

function osm(tags: Record<string, string> = { highway: 'footway' }, nodeCount = 6): OsmData {
	return {
		elements: [
			{ type: 'way', id: 1, nodes: [1, 2, 3, 4, 5, 6].slice(0, nodeCount), tags },
			...[1, 2, 3, 4, 5, 6]
				.slice(0, nodeCount)
				.map((id) => ({ type: 'node' as const, id, lat: (id - 1) * 5 * M, lon: 0 }))
		]
	};
}

function file(slopeIssues: ElevationFile['slopeIssues']): ElevationFile {
	return {
		format: ELEVATION_FILE_FORMAT,
		source: { dataset: 'test' },
		elevationsM: Object.fromEntries(ELEVATIONS.map((z, i) => [String(i + 1), z])),
		slopeIssues
	};
}

const allShort: ElevationFile['slopeIssues'] = Object.fromEntries(
	[0, 1, 2, 3, 4].map((i) => [`w1:${i}`, ['short-segment' as const]])
);

function slopes(
	data: OsmData,
	issues: ElevationFile['slopeIssues'],
	{ derive = true, smooth = true } = {}
) {
	const dataset = new ElevationDataset(file(issues));
	const result = new OsmCampusTransformer(dataset.transformOptions(derive, smooth)).transform(data);
	return Object.fromEntries(result.data.edges.map((e) => [e.id, e.slopePct]));
}

describe('ElevationDataset.isSlopeSmoothable', () => {
	const dataset = new ElevationDataset(
		file({
			'w1:0': ['short-segment'],
			'w1:1': ['short-segment', 'structure'],
			'w1:2': ['irregular-profile']
		})
	);

	it('is true only when "too short" is the only reason the slope is unreliable', () => {
		expect(dataset.isSlopeSmoothable('w1:0')).toBe(true);
		expect(dataset.isSlopeSmoothable('w1:1')).toBe(false);
		expect(dataset.isSlopeSmoothable('w1:2')).toBe(false);
	});

	it('is false for a segment with no issues (its own slope is already reliable)', () => {
		expect(dataset.isSlopeSmoothable('w1:3')).toBe(false);
	});
});

describe('smoothing short segments', () => {
	it('gives each short segment the grade of a 15 m stretch of the same way', () => {
		const s = slopes(osm(), allShort);
		// Stretches: w1:0, w1:1, w1:2 are all flat (nodes 1-4 or 2-5 at 100 m).
		expect(s['w1:0']).toBeCloseTo(0, 5);
		expect(s['w1:1']).toBeCloseTo(0, 5);
		expect(s['w1:2']).toBeCloseTo(0, 5);
		// w1:3 and w1:4 use the stretch node 3 to node 6: 1 m up over about 15 m.
		expect(s['w1:3']).toBeCloseTo(6.67, 1);
		expect(s['w1:4']).toBeCloseTo(6.67, 1);
	});

	it('leaves short segments without a slope when smoothing is off', () => {
		const s = slopes(osm(), allShort, { smooth: false });
		expect(Object.values(s).every((v) => v === undefined)).toBe(true);
	});

	it('derives nothing when slope derivation is off, even with smoothing on', () => {
		const s = slopes(osm(), allShort, { derive: false });
		expect(Object.values(s).every((v) => v === undefined)).toBe(true);
	});

	it('keeps a reliable segment on its own grade instead of smoothing it', () => {
		const s = slopes(osm(), { 'w1:0': ['short-segment'] });
		// w1:4 is not flagged: its own grade is 1 m over about 5 m = 20%.
		expect(s['w1:4']).toBeGreaterThan(19);
		expect(s['w1:4']).toBeLessThan(20.1);
	});

	it('does not stretch across a neighbor whose slope is unreliable for another reason', () => {
		const s = slopes(osm(), { ...allShort, 'w1:3': ['structure'] });
		expect(s['w1:3']).toBeUndefined(); // the bridge-like segment itself
		expect(s['w1:4']).toBeUndefined(); // cannot reach 15 m without crossing it
		expect(s['w1:2']).toBeCloseTo(0, 5); // can still stretch backwards (nodes 2-5)
	});

	it('gives no slope when the whole way is shorter than the window', () => {
		const dataset = new ElevationDataset(file(allShort));
		const result = new OsmCampusTransformer(dataset.transformOptions(true, true)).transform(
			osm({ highway: 'footway' }, 3)
		);
		expect(result.data.edges.every((e) => e.slopePct === undefined)).toBe(true);
	});

	it('lets a tagged incline win over a smoothed grade', () => {
		const s = slopes(osm({ highway: 'footway', incline: '3%' }), allShort);
		expect(Object.values(s).every((v) => v === 3)).toBe(true);
	});

	it('never derives a slope for stairs (they are penalized by stair rules)', () => {
		const s = slopes(osm({ highway: 'steps' }), {});
		expect(Object.values(s).every((v) => v === undefined)).toBe(true);
	});

	it('signs the reverse direction opposite to the forward direction', async () => {
		const dataset = new ElevationDataset(file(allShort));
		const data = new OsmCampusTransformer(dataset.transformOptions(true, true)).transform(
			osm()
		).data;
		const repo = new CampusRepository({ load: async () => structuredClone(data) });
		await repo.loadCampusData();
		const forward = repo.getNeighboringPaths('n5').find((e) => e.id === 'w1:4')!;
		const reverse = repo.getNeighboringPaths('n6').find((e) => e.id === 'w1:4:rev')!;
		expect(forward.slopePct).toBeGreaterThan(0);
		expect(reverse.slopePct).toBeCloseTo(-forward.slopePct!, 5);
	});
});
