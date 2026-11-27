import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { CampusBoundary, type CampusBoundaryFile } from './CampusBoundary';
import { MalformedDataError } from './errors';
import type { LngLat } from './types';

const square: LngLat[] = [
	[-106.51, 31.76],
	[-106.5, 31.76],
	[-106.5, 31.77],
	[-106.51, 31.77]
];

describe('CampusBoundary', () => {
	it('contains a point inside the polygon', () => {
		expect(new CampusBoundary(square).contains([-106.505, 31.765])).toBe(true);
	});

	it('does not contain a point outside the polygon', () => {
		const boundary = new CampusBoundary(square);
		expect(boundary.contains([-106.495, 31.765])).toBe(false);
		expect(boundary.contains([-106.505, 31.775])).toBe(false);
	});

	it('treats a closed ring the same as an open one', () => {
		const closed = new CampusBoundary([...square, square[0]]);
		expect(closed.ring).toHaveLength(4);
		expect(closed.contains([-106.505, 31.765])).toBe(true);
	});

	it('reads a GeoJSON Polygon Feature and a bare Polygon', () => {
		const coordinates = [square.map(([lng, lat]) => [lng, lat])];
		const feature: CampusBoundaryFile = {
			type: 'Feature',
			geometry: { type: 'Polygon', coordinates }
		};
		const bare: CampusBoundaryFile = { type: 'Polygon', coordinates };
		expect(CampusBoundary.fromGeoJson(feature).contains([-106.505, 31.765])).toBe(true);
		expect(CampusBoundary.fromGeoJson(bare).contains([-106.505, 31.765])).toBe(true);
	});

	it('rejects malformed boundaries', () => {
		expect(() => new CampusBoundary(square.slice(0, 2))).toThrow(MalformedDataError);
		expect(() => new CampusBoundary([...square.slice(0, 3), [NaN, 31.77]])).toThrow(
			MalformedDataError
		);
		expect(() => new CampusBoundary([...square.slice(0, 3), [-106.5, 95]])).toThrow(
			MalformedDataError
		);
		expect(() => CampusBoundary.fromGeoJson({ type: 'Feature' } as CampusBoundaryFile)).toThrow(
			MalformedDataError
		);
	});

	it('freezes its ring so the boundary cannot be changed after loading', () => {
		const boundary = new CampusBoundary(square);
		expect(Object.isFrozen(boundary.ring)).toBe(true);
		expect(Object.isFrozen(boundary.ring[0])).toBe(true);
	});

	it('loads the project boundary file', () => {
		const file = JSON.parse(
			readFileSync('static/data/campus-boundary.json', 'utf8')
		) as CampusBoundaryFile;
		const boundary = CampusBoundary.fromGeoJson(file);
		// University Library is the center of the supported area.
		expect(boundary.contains([-106.5052, 31.7681])).toBe(true);
		expect(boundary.ring.length).toBeGreaterThanOrEqual(3);
	});
});
