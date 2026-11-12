import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CampusRepository } from '../campusdata';
import type { RawCampusData } from '../campusdata/types';
import { RouteController } from './RouteController';
import type { RouteResponse, RouteSelection } from './types';

/**
 * Tests for the Controller (AC-1 to AC-4) wired to the REAL CampusRepository and the REAL
 * RouteEngine, using the seed campus.json. Nothing is mocked.
 *
 * Problems found in the Controller are NOT tested here (these tests describe what works).
 * They are recorded in src/lib/integration/ControllerAndApp.knownIssues.test.ts.
 */

type SerializedRoute = {
	nodeIds: string[];
	coordinates: [number, number][];
	totalDistanceM: number;
	stairSegmentCount: number;
	unverifiedAccessibilityDistanceM: number;
	[key: string]: unknown;
};

const seed = (): RawCampusData =>
	JSON.parse(readFileSync('static/data/campus.json', 'utf8')) as RawCampusData;

const building = (buildingId: string) => ({ kind: 'building' as const, buildingId });

const select = (
	from: string,
	to: string,
	mode: RouteSelection['mode'] = 'shortest'
): RouteSelection => ({ origin: building(from), destination: building(to), mode });

/** The seed data with some entrances removed, to build "no usable entrance" situations. */
function withoutEntrances(...ids: string[]): RawCampusData {
	const data = seed();
	data.entrances = data.entrances.filter((e) => !ids.includes(e.id));
	return data;
}

function make(data: RawCampusData = seed()) {
	const repo = new CampusRepository({ load: async () => structuredClone(data) });
	return { repo, controller: new RouteController(repo) };
}

/** A controller whose repository is already loaded (needed to call validateRouteRequest directly). */
async function makeLoaded(data?: RawCampusData) {
	const ctx = make(data);
	await ctx.repo.loadCampusData();
	return ctx;
}

function expectSuccess(response: RouteResponse): SerializedRoute {
	expect(response.status).toBe('success');
	if (response.status !== 'success') throw new Error('expected a successful response');
	return response.route as unknown as SerializedRoute;
}

function expectFailure(response: RouteResponse) {
	expect(response.status).toBe('failure');
	if (response.status !== 'failure') throw new Error('expected a failure response');
	return response.failure;
}

// The Controller logs unexpected errors with console.error; keep the test output clean.
beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('AC-1 processRouteRequest: successful routes', () => {
	it('ada: Union to Engineering uses the ramp', async () => {
		const { controller } = make();
		const route = expectSuccess(
			await controller.processRouteRequest(select('b_union', 'b_eng', 'ada'))
		);
		expect(route.nodeIds).toEqual(['n_union', 'n_plaza', 'n_ramp_a', 'n_ramp_b', 'n_eng_door']);
		expect(route.totalDistanceM).toBeCloseTo(250.2, 1);
		expect(route.stairSegmentCount).toBe(0);
	});

	it('shortest: Union to Engineering takes the stairs', async () => {
		const { controller } = make();
		const route = expectSuccess(
			await controller.processRouteRequest(select('b_union', 'b_eng', 'shortest'))
		);
		expect(route.totalDistanceM).toBeCloseTo(191.3, 1);
		expect(route.stairSegmentCount).toBe(1);
	});

	it('easy: Union to Engineering avoids the stairs', async () => {
		const { controller } = make();
		const route = expectSuccess(
			await controller.processRouteRequest(select('b_union', 'b_eng', 'easy'))
		);
		expect(route.stairSegmentCount).toBe(0);
	});

	it('returns a zero-length route when start and destination are the same building', async () => {
		const { controller } = make();
		const route = expectSuccess(await controller.processRouteRequest(select('b_union', 'b_union')));
		expect(route.totalDistanceM).toBe(0);
	});

	it('returns the same answer when asked twice in a row', async () => {
		const { controller } = make();
		const first = await controller.processRouteRequest(select('b_library', 'b_sci', 'ada'));
		const second = await controller.processRouteRequest(select('b_library', 'b_sci', 'ada'));
		expect(second).toEqual(first);
	});

	it('serializes the route to plain data that survives JSON (what an HTTP reply needs)', async () => {
		const { controller } = make();
		const response = await controller.processRouteRequest(select('b_union', 'b_eng', 'ada'));
		expect(JSON.parse(JSON.stringify(response))).toEqual(response);
	});

	it('includes the fields the UI needs: coordinates, distance, time and accessibility warnings', async () => {
		const { controller } = make();
		const route = expectSuccess(
			await controller.processRouteRequest(select('b_union', 'b_gym', 'ada'))
		);
		expect(route.coordinates).toHaveLength(2);
		expect(route.estimatedWalkTimeS).toBeGreaterThan(0);
		expect(route.unverifiedAccessibilityDistanceM).toBeCloseTo(72.1, 1);
	});
});

describe('AC-1 processRouteRequest: failures', () => {
	it('reports NO_ROUTE / UNREACHABLE for the disconnected Remote Annex', async () => {
		const { controller } = make();
		const failure = expectFailure(
			await controller.processRouteRequest(select('b_union', 'b_annex', 'easy'))
		);
		expect(failure).toMatchObject({ code: 'NO_ROUTE', noRouteReason: 'UNREACHABLE' });
		expect(failure.message).toMatch(/No route exists/);
	});

	it('reports NO_USABLE_DESTINATION when the destination has no entrance usable in ada mode', async () => {
		// Engineering keeps only its inaccessible side entrance.
		const { controller } = make(withoutEntrances('en_eng_main'));
		const failure = expectFailure(
			await controller.processRouteRequest(select('b_union', 'b_eng', 'ada'))
		);
		expect(failure).toMatchObject({ code: 'NO_ROUTE', noRouteReason: 'NO_USABLE_DESTINATION' });
	});

	it('reports NO_USABLE_ORIGIN when the start has no entrance usable in ada mode', async () => {
		const { controller } = make(withoutEntrances('en_eng_main'));
		const failure = expectFailure(
			await controller.processRouteRequest(select('b_eng', 'b_union', 'ada'))
		);
		expect(failure).toMatchObject({ code: 'NO_ROUTE', noRouteReason: 'NO_USABLE_ORIGIN' });
	});

	it('still routes to that building in shortest mode (it only blocks ada)', async () => {
		const { controller } = make(withoutEntrances('en_eng_main'));
		const route = expectSuccess(
			await controller.processRouteRequest(select('b_union', 'b_eng', 'shortest'))
		);
		expect(route.totalDistanceM).toBeCloseTo(191.3, 1);
	});

	it('turns an invalid selection into INVALID_REQUEST with the validation code', async () => {
		const { controller } = make();
		const failure = expectFailure(
			await controller.processRouteRequest(select('b_nope', 'b_eng', 'easy'))
		);
		expect(failure).toMatchObject({ code: 'INVALID_REQUEST', validationCode: 'UNKNOWN_BUILDING' });
	});

	it('reports DATA_NOT_READY when the campus data cannot be loaded', async () => {
		const repo = new CampusRepository({
			load: async () => {
				throw new Error('disk gone');
			}
		});
		const failure = expectFailure(
			await new RouteController(repo).processRouteRequest(select('b_union', 'b_eng'))
		);
		expect(failure.code).toBe('DATA_NOT_READY');
	});

	it('reports DATA_NOT_READY when the campus data is malformed', async () => {
		const bad = seed();
		bad.nodes.push({ ...bad.nodes[0] }); // duplicate node id
		const { controller } = make(bad);
		const failure = expectFailure(await controller.processRouteRequest(select('b_union', 'b_eng')));
		expect(failure.code).toBe('DATA_NOT_READY');
	});
});

describe('AC-2 validateRouteRequest', () => {
	it('accepts two known buildings in a supported mode', async () => {
		const { controller } = await makeLoaded();
		expect(controller.validateRouteRequest(select('b_union', 'b_eng', 'ada'))).toEqual({
			valid: true
		});
	});

	it('rejects a missing origin', async () => {
		const { controller } = await makeLoaded();
		const selection = { ...select('b_union', 'b_eng'), origin: undefined as never };
		expect(controller.validateRouteRequest(selection)).toMatchObject({
			valid: false,
			code: 'MISSING_ORIGIN'
		});
	});

	it('rejects a missing destination', async () => {
		const { controller } = await makeLoaded();
		const selection = { ...select('b_union', 'b_eng'), destination: undefined as never };
		expect(controller.validateRouteRequest(selection)).toMatchObject({
			valid: false,
			code: 'MISSING_DESTINATION'
		});
	});

	it('rejects a routing mode that does not exist', async () => {
		const { controller } = await makeLoaded();
		const selection = { ...select('b_union', 'b_eng'), mode: 'walk' as never };
		const result = controller.validateRouteRequest(selection);
		expect(result).toMatchObject({ valid: false, code: 'UNSUPPORTED_MODE' });
		expect(JSON.stringify(result)).toContain("'walk'");
	});

	it.each([
		['origin', select('b_nope', 'b_eng')],
		['destination', select('b_union', 'b_nope')]
	])('rejects an unknown building as the %s', async (_label, selection) => {
		const { controller } = await makeLoaded();
		expect(controller.validateRouteRequest(selection)).toMatchObject({
			valid: false,
			code: 'UNKNOWN_BUILDING'
		});
	});

	it.each([
		['origin', select('b_gym', 'b_eng'), /Starting building has no registered entrances/],
		['destination', select('b_eng', 'b_gym'), /Destination building has no registered entrances/]
	])('rejects a building with no entrances as the %s', async (_label, selection, message) => {
		const { controller } = await makeLoaded(withoutEntrances('en_gym_main'));
		const result = controller.validateRouteRequest(selection);
		expect(result).toMatchObject({ valid: false, code: 'NO_ENTRANCES' });
		expect(JSON.stringify(result)).toMatch(message);
	});
});

describe('AC-3 retrieveRouteResult', () => {
	it('reports a failure (not a crash) if called before any request created the engine', () => {
		const { controller } = make();
		const failure = expectFailure(
			controller.retrieveRouteResult({ mode: 'shortest', origins: [], destinations: [] })
		);
		expect(failure.code).toBe('UNEXPECTED_ERROR');
	});
});

describe('AC-4 handleRouteFailure', () => {
	it.each([
		['NO_USABLE_ORIGIN', /starting building/i],
		['NO_USABLE_DESTINATION', /destination building/i],
		['UNREACHABLE', /No route exists/]
	] as const)('explains a no-route result: %s', (reason, message) => {
		const { controller } = make();
		const failure = expectFailure(
			controller.handleRouteFailure({ status: 'no-route', mode: 'ada', reason })
		);
		expect(failure).toMatchObject({ code: 'NO_ROUTE', noRouteReason: reason });
		expect(failure.message).toMatch(message);
	});

	it('keeps the validation code for a ValidationFailure', () => {
		const { controller } = make();
		const failure = expectFailure(
			controller.handleRouteFailure({
				name: 'ValidationFailure',
				code: 'MISSING_ORIGIN',
				message: 'Starting location is required.'
			})
		);
		expect(failure).toEqual({
			code: 'INVALID_REQUEST',
			message: 'Starting location is required.',
			validationCode: 'MISSING_ORIGIN'
		});
	});

	it('maps a CampusDataLoadError to DATA_NOT_READY', () => {
		const { controller } = make();
		const failure = expectFailure(
			controller.handleRouteFailure({ name: 'CampusDataLoadError', message: 'x' })
		);
		expect(failure.code).toBe('DATA_NOT_READY');
	});

	it.each([[new Error('boom')], [null], [undefined], ['just a string']])(
		'maps anything else (%s) to a safe UNEXPECTED_ERROR message',
		(cause) => {
			const { controller } = make();
			const failure = expectFailure(controller.handleRouteFailure(cause));
			expect(failure).toEqual({
				code: 'UNEXPECTED_ERROR',
				message: 'Something went wrong. Please try again.'
			});
		}
	);
});
