import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CampusRepository } from '../campusdata';
import type { RawCampusData } from '../campusdata/types';
import { RouteController } from '../controller/RouteController';
import type { RouteSelection } from '../controller/types';
import { listBuildings } from '../server/campus';
import { handleRouteApi } from '../server/routeApi';
import { parseRouteResult } from '../ui/RouteService';
import { POST } from '../../routes/api/route/+server';

/**
 * Controller + application wiring: the problems found earlier are fixed, so these are
 * normal tests that keep them fixed.
 */

const seed = (): RawCampusData =>
	JSON.parse(readFileSync('static/data/campus.json', 'utf8')) as RawCampusData;

const building = (buildingId: string) => ({ kind: 'building' as const, buildingId });

const select = (
	from: string,
	to: string,
	mode: RouteSelection['mode'] = 'shortest'
): RouteSelection => ({ origin: building(from), destination: building(to), mode });

/** A controller on a repository that counts how often the data is loaded. */
function make(loadData: (callNumber: number) => RawCampusData = seed) {
	let loads = 0;
	const repo = new CampusRepository({
		load: async () => structuredClone(loadData(++loads))
	});
	return { repo, controller: new RouteController(repo), loads: () => loads };
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
});

// A point exactly on node n_union (lng, lat), and a point far from every path.
const ON_A_PATH_NODE: [number, number] = [-106.504, 31.77];
const FAR_AWAY: [number, number] = [-100, 20];

describe('Controller: selecting a point on the map (kind: "mapPoint")', () => {
	it('finds a route when the start is a map point that sits on a path node', async () => {
		const { controller } = make();
		const response = await controller.processRouteRequest({
			origin: { kind: 'mapPoint', location: ON_A_PATH_NODE },
			destination: building('b_eng'),
			mode: 'shortest'
		});
		expect(response.status).toBe('success');
	});

	it('says LOCATION_OFF_NETWORK for a map point far from every path', async () => {
		const { controller } = make();
		const response = await controller.processRouteRequest({
			origin: { kind: 'mapPoint', location: FAR_AWAY },
			destination: building('b_eng'),
			mode: 'shortest'
		});
		expect(response).toMatchObject({
			status: 'failure',
			failure: { code: 'INVALID_REQUEST', validationCode: 'LOCATION_OFF_NETWORK' }
		});
	});
});

describe('Controller: validateRouteRequest before the data is loaded', () => {
	it('returns a validation result instead of throwing', () => {
		const { controller } = make();
		expect(controller.validateRouteRequest(select('b_union', 'b_eng', 'ada'))).toMatchObject({
			valid: false,
			code: 'DATA_NOT_LOADED'
		});
	});
});

describe('Controller: campus data loading', () => {
	it('loads the campus data once, not once per request', async () => {
		const { controller, loads } = make();
		await controller.processRouteRequest(select('b_union', 'b_eng'));
		await controller.processRouteRequest(select('b_union', 'b_library'));
		expect(loads()).toBe(1);
	});

	it('loads once even when two requests arrive at the same time', async () => {
		const { controller, loads } = make();
		await Promise.all([
			controller.processRouteRequest(select('b_union', 'b_eng')),
			controller.processRouteRequest(select('b_union', 'b_library'))
		]);
		expect(loads()).toBe(1);
	});

	it('tries again after a failed load', async () => {
		let calls = 0;
		const repo = new CampusRepository({
			load: async () => {
				if (++calls === 1) throw new Error('disk error');
				return seed();
			}
		});
		const controller = new RouteController(repo);
		const first = await controller.processRouteRequest(select('b_union', 'b_eng'));
		expect(first).toMatchObject({ status: 'failure', failure: { code: 'DATA_NOT_READY' } });
		const second = await controller.processRouteRequest(select('b_union', 'b_eng'));
		expect(second.status).toBe('success');
	});

	it('routes on the newest data after the repository is reloaded', async () => {
		const withoutUnionPlaza = (): RawCampusData => {
			const data = seed();
			data.edges = data.edges.filter((e) => e.id !== 'e_union_plaza');
			return data;
		};
		const { repo, controller } = make((call) => (call === 1 ? seed() : withoutUnionPlaza()));
		const first = await controller.processRouteRequest(select('b_union', 'b_library'));
		expect(first.status).toBe('success');
		await repo.loadCampusData(); // second load: the Union-Plaza path is gone
		const second = await controller.processRouteRequest(select('b_union', 'b_library'));
		expect(second).toMatchObject({ status: 'failure', failure: { noRouteReason: 'UNREACHABLE' } });
	});
});

describe('Controller: error type is not guessed from the message text', () => {
	it('does not call an unrelated error DATA_NOT_READY just because its text contains "load"', () => {
		const { controller } = make();
		const response = controller.handleRouteFailure(new Error('failed to download map tiles'));
		expect(response).toMatchObject({ status: 'failure', failure: { code: 'UNEXPECTED_ERROR' } });
	});
});

describe('API reply (handleRouteApi): what the page receives', () => {
	it('sends coordinates, distanceMeters and estimatedMinutes the UI can read', async () => {
		const { controller } = make();
		const reply = await handleRouteApi(
			{ startBuildingId: 'b_union', destinationBuildingId: 'b_eng', mode: 'ada' },
			controller
		);
		expect(reply.status).toBe(200);
		const parsed = parseRouteResult(reply.body);
		expect(parsed.coordinates.length).toBeGreaterThanOrEqual(2);
		expect(parsed.distanceMeters).toBeCloseTo(250.2, 1);
		expect(parsed.estimatedMinutes).toBeGreaterThan(0);
	});

	it('answers 422 { status: "no_route" } when the building cannot be reached', async () => {
		const { controller } = make();
		const reply = await handleRouteApi(
			{ startBuildingId: 'b_union', destinationBuildingId: 'b_annex', mode: 'shortest' },
			controller
		);
		expect(reply.status).toBe(422);
		expect(reply.body).toMatchObject({ status: 'no_route' });
	});

	it('answers 400 for an unknown building', async () => {
		const { controller } = make();
		const reply = await handleRouteApi(
			{ startBuildingId: 'nope', destinationBuildingId: 'b_eng', mode: 'shortest' },
			controller
		);
		expect(reply.status).toBe(400);
	});

	it.each([null, 'text', {}, { startBuildingId: 'b_union' }])(
		'answers 400 for body %j',
		async (body) => {
			const { controller } = make();
			expect((await handleRouteApi(body, controller)).status).toBe(400);
		}
	);

	it('answers 400 for an unsupported mode', async () => {
		const { controller } = make();
		const reply = await handleRouteApi(
			{ startBuildingId: 'b_union', destinationBuildingId: 'b_eng', mode: 'fly' },
			controller
		);
		expect(reply.status).toBe(400);
	});

	it('answers 503 when the campus data cannot be loaded', async () => {
		const controller = new RouteController(
			new CampusRepository({
				load: async () => {
					throw new Error('disk error');
				}
			})
		);
		const reply = await handleRouteApi(
			{ startBuildingId: 'b_union', destinationBuildingId: 'b_eng', mode: 'shortest' },
			controller
		);
		expect(reply.status).toBe(503);
	});
});

describe('The real /api/route endpoint and the page data', () => {
	const post = (body: string) =>
		POST({
			request: new Request('http://localhost/api/route', { method: 'POST', body })
		} as Parameters<typeof POST>[0]);

	it('POST /api/route returns a drawable route for Union -> Engineering (shortest)', async () => {
		const response = await post(
			JSON.stringify({
				startBuildingId: 'b_union',
				destinationBuildingId: 'b_eng',
				mode: 'shortest'
			})
		);
		expect(response.status).toBe(200);
		const parsed = parseRouteResult(await response.json());
		expect(parsed.distanceMeters).toBeCloseTo(191.3, 1);
	});

	it('POST /api/route answers 400 when the body is not JSON', async () => {
		expect((await post('not json')).status).toBe(400);
	});

	it('offers only building ids that exist in the campus data', async () => {
		const repo = new CampusRepository({ load: async () => seed() });
		await repo.loadCampusData();
		const campusIds = repo.getBuildings().map((b) => b.id);
		const pageBuildings = await listBuildings();
		expect(pageBuildings.map((b) => b.id).sort()).toEqual(campusIds.sort());
		for (const b of pageBuildings) {
			expect(Number.isFinite(b.coordinates[0])).toBe(true);
			expect(Number.isFinite(b.coordinates[1])).toBe(true);
		}
	});
});
