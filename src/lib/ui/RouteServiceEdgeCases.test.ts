import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpRouteService, parseRouteResult } from './RouteService';
import { NoRouteError, type RouteRequest } from './types';

afterEach(() => vi.unstubAllGlobals());

const REQUEST: RouteRequest = {
	startBuildingId: 'b_union',
	destinationBuildingId: 'b_eng',
	mode: 'ada'
};
const TWO_POINTS = [
	[-106.5, 31.77],
	[-106.51, 31.78]
];

describe('HttpRouteService: how HTTP statuses are handled', () => {
	it('turns HTTP 422 into NoRouteError', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422 }));
		await expect(new HttpRouteService().getRoute(REQUEST)).rejects.toBeInstanceOf(NoRouteError);
	});

	it('treats HTTP 404 as a failed request, not as "no route"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
		const error = await new HttpRouteService().getRoute(REQUEST).catch((e: unknown) => e);
		expect(error).not.toBeInstanceOf(NoRouteError);
		expect((error as Error).message).toMatch(/404/);
	});

	it('passes the abort signal on to fetch', async () => {
		const mockedFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ coordinates: TWO_POINTS })
		});
		vi.stubGlobal('fetch', mockedFetch);
		const controller = new AbortController();
		await new HttpRouteService().getRoute(REQUEST, controller.signal);
		expect(mockedFetch.mock.calls[0][1].signal).toBe(controller.signal);
	});

	it('lets a network failure reach the caller', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
		await expect(new HttpRouteService().getRoute(REQUEST)).rejects.toThrow('Failed to fetch');
	});

	it('posts to a custom endpoint when one is given', async () => {
		const mockedFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ coordinates: TWO_POINTS })
		});
		vi.stubGlobal('fetch', mockedFetch);
		await new HttpRouteService('/custom/route').getRoute(REQUEST);
		expect(mockedFetch.mock.calls[0][0]).toBe('/custom/route');
	});
});

describe('parseRouteResult: rejecting bad responses', () => {
	it.each([null, undefined, 'text', 42])('rejects %s because it is not an object', (value) => {
		expect(() => parseRouteResult(value)).toThrow(/expected an object/);
	});

	it('rejects coordinates that are not an array', () => {
		expect(() => parseRouteResult({ coordinates: 'abc' })).toThrow(/coordinates/);
	});

	it('rejects a route with only one point', () => {
		expect(() => parseRouteResult({ coordinates: [[-106.5, 31.77]] })).toThrow(/coordinates/);
	});

	it('rejects latitude above 90', () => {
		expect(() =>
			parseRouteResult({
				coordinates: [
					[0, 91],
					[0, 0]
				]
			})
		).toThrow(/coordinates/);
	});

	it('rejects a coordinate that is NaN', () => {
		expect(() =>
			parseRouteResult({
				coordinates: [
					[NaN, 0],
					[0, 0]
				]
			})
		).toThrow(/coordinates/);
	});

	it('rejects a negative distance', () => {
		expect(() => parseRouteResult({ coordinates: TWO_POINTS, distanceMeters: -1 })).toThrow(
			/distanceMeters must be nonnegative/
		);
	});

	it('rejects minutes that are not a number', () => {
		expect(() => parseRouteResult({ coordinates: TWO_POINTS, estimatedMinutes: '5' })).toThrow(
			/estimatedMinutes must be nonnegative/
		);
	});
});

describe('parseRouteResult: optional fields', () => {
	it('treats null distance and minutes as absent', () => {
		const result = parseRouteResult({
			coordinates: TWO_POINTS,
			distanceMeters: null,
			estimatedMinutes: null
		});
		expect(result.distanceMeters).toBeUndefined();
		expect(result.estimatedMinutes).toBeUndefined();
	});

	it('accepts a distance of exactly zero', () => {
		expect(parseRouteResult({ coordinates: TWO_POINTS, distanceMeters: 0 }).distanceMeters).toBe(0);
	});

	it('keeps instructions that are all strings', () => {
		const result = parseRouteResult({
			coordinates: TWO_POINTS,
			instructions: ['Go north', 'Turn']
		});
		expect(result.instructions).toEqual(['Go north', 'Turn']);
	});

	it('drops malformed instructions instead of failing the whole route', () => {
		const result = parseRouteResult({ coordinates: TWO_POINTS, instructions: [1, 2] });
		expect(result.instructions).toBeUndefined();
		expect(result.coordinates).toHaveLength(2);
	});
});
