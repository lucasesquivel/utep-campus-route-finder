import { describe, it, expect } from 'vitest';
import { haversineM, pointInRing, polygonCentroid } from './geo';
import type { LngLat } from './types';

/** A 4 x 4 square with its corner at the origin, ring closed (first point repeated). */
const SQUARE: LngLat[] = [
	[0, 0],
	[4, 0],
	[4, 4],
	[0, 4],
	[0, 0]
];

describe('haversineM', () => {
	it('is zero for identical points', () => {
		expect(haversineM(31.77, -106.504, 31.77, -106.504)).toBe(0);
	});

	it('is symmetric', () => {
		const ab = haversineM(31.77, -106.504, 31.7712, -106.5058);
		const ba = haversineM(31.7712, -106.5058, 31.77, -106.504);
		expect(ab).toBeCloseTo(ba, 9);
	});

	it('measures one degree of latitude as about 111.2 km', () => {
		expect(haversineM(0, 0, 1, 0)).toBeCloseTo(111_195, 0);
	});

	it('agrees with the Union Building to Plaza distance stored in the seed data (44.5 m)', () => {
		expect(haversineM(31.77, -106.504, 31.7704, -106.504)).toBeCloseTo(44.5, 0);
	});

	it('does not return NaN for antipodal points', () => {
		const d = haversineM(0, 0, 0, 180);
		expect(Number.isFinite(d)).toBe(true);
		expect(d).toBeCloseTo(Math.PI * 6_371_008.8, -1);
	});
});

describe('pointInRing', () => {
	it('is true for a point inside', () => {
		expect(pointInRing([2, 2], SQUARE)).toBe(true);
	});

	it('is false for points outside on every side', () => {
		expect(pointInRing([5, 2], SQUARE)).toBe(false);
		expect(pointInRing([-1, 2], SQUARE)).toBe(false);
		expect(pointInRing([2, 5], SQUARE)).toBe(false);
		expect(pointInRing([2, -1], SQUARE)).toBe(false);
	});

	it('gives the same answer for an open ring (last point not repeated)', () => {
		const open = SQUARE.slice(0, -1);
		expect(pointInRing([2, 2], open)).toBe(true);
		expect(pointInRing([9, 9], open)).toBe(false);
	});

	it('handles a concave L-shape: inside the arm is true, inside the notch is false', () => {
		const ell: LngLat[] = [
			[0, 0],
			[4, 0],
			[4, 2],
			[2, 2],
			[2, 4],
			[0, 4]
		];
		expect(pointInRing([1, 3], ell)).toBe(true);
		expect(pointInRing([3, 3], ell)).toBe(false);
	});

	it('is false for an empty ring', () => {
		expect(pointInRing([0, 0], [])).toBe(false);
	});
});

describe('polygonCentroid', () => {
	it('finds the centre of a closed square', () => {
		const [x, y] = polygonCentroid(SQUARE);
		expect(x).toBeCloseTo(2, 9);
		expect(y).toBeCloseTo(2, 9);
	});

	it('gives the same answer for an open ring', () => {
		const [x, y] = polygonCentroid(SQUARE.slice(0, -1));
		expect(x).toBeCloseTo(2, 9);
		expect(y).toBeCloseTo(2, 9);
	});

	it('gives the same answer for clockwise and counter-clockwise rings', () => {
		const reversed = [...SQUARE].reverse();
		const [x, y] = polygonCentroid(reversed);
		expect(x).toBeCloseTo(2, 9);
		expect(y).toBeCloseTo(2, 9);
	});

	it('finds the centroid of a triangle (one third of the way from the right-angle corner)', () => {
		const [x, y] = polygonCentroid([
			[0, 0],
			[6, 0],
			[0, 6]
		]);
		expect(x).toBeCloseTo(2, 9);
		expect(y).toBeCloseTo(2, 9);
	});

	it('falls back to the average of the points for a zero-area (collinear) ring', () => {
		expect(
			polygonCentroid([
				[0, 0],
				[2, 2],
				[4, 4]
			])
		).toEqual([2, 2]);
	});

	it('returns a single point unchanged', () => {
		expect(polygonCentroid([[5, 7]])).toEqual([5, 7]);
	});

	it('throws RangeError for an empty ring', () => {
		expect(() => polygonCentroid([])).toThrow(RangeError);
	});
});
