import { describe, expect, it } from 'vitest';
import { haversineDistanceM } from './haversine';

describe('haversineDistanceM', () => {
	it('is zero for identical points', () => {
		expect(haversineDistanceM([-106.5, 31.77], [-106.5, 31.77])).toBe(0);
	});

	it('is symmetric', () => {
		const a = [-106.5049, 31.7709] as const;
		const b = [-106.5021, 31.7735] as const;
		expect(haversineDistanceM(a, b)).toBeCloseTo(haversineDistanceM(b, a), 9);
	});

	it('matches one degree of latitude (~111.2 km)', () => {
		expect(haversineDistanceM([0, 0], [0, 1])).toBeCloseTo(111_195, -1);
	});

	it('shrinks longitude distance by cos(latitude)', () => {
		const atEquator = haversineDistanceM([0, 0], [0.001, 0]);
		const atCampus = haversineDistanceM([-106.5, 31.77], [-106.499, 31.77]);
		expect(atCampus / atEquator).toBeCloseTo(Math.cos((31.77 * Math.PI) / 180), 4);
	});

	it('handles antipodal points without NaN', () => {
		const d = haversineDistanceM([0, 0], [180, 0]);
		expect(Number.isFinite(d)).toBe(true);
		expect(d).toBeCloseTo(Math.PI * 6_371_008.8, 0);
	});
});
