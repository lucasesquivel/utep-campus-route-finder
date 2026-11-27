import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { CampusBoundary, type CampusBoundaryFile } from '../campusdata/CampusBoundary';
import type { RouteMode } from '../controller/types';
import { listBuildings, routeController } from '../server/campus';
import type { Building } from '../ui/types';

/**
 * Supported campus scope on the real UTEP data, through the same loader the app uses
 * (OSM export + DEM elevations + campus-corrections.json + campus-boundary.json).
 *
 * Contract checked here: every building offered in the selector is inside the inner-campus
 * boundary and can be reached from the University Library in every routing mode. A building
 * that cannot be routed to must either get an entrance/connection correction or be left out.
 */

const MODES: readonly RouteMode[] = ['shortest', 'easy', 'ada'];

/** Neighbors and distant facilities in the map export that are outside the supported scope. */
const OUT_OF_SCOPE = [
	"McDonald's",
	'Hilton Garden Inn El Paso/University',
	'Mesa Hills Healthcare Residence',
	'Providence Memorial Hospital',
	'Traffic Control Booth 1',
	'Larry K. Durham Sports Center'
];

let buildings: Building[];
let library: Building;

beforeAll(async () => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
	buildings = await listBuildings();
	library = buildings.find((b) => b.name === 'University Library')!;
}, 60_000);

describe('supported campus scope (real UTEP data)', () => {
	it('offers the inner-campus buildings, including the hub used below', () => {
		expect(library).toBeDefined();
		expect(buildings.length).toBe(45);
		expect(buildings.map((b) => b.name)).toEqual(
			expect.arrayContaining(['Old Main', 'Memorial Gym', 'Holliday Hall', 'Union West'])
		);
	});

	it('leaves out neighboring businesses and distant facilities', () => {
		const names = buildings.map((b) => b.name);
		for (const name of OUT_OF_SCOPE) expect(names).not.toContain(name);
	});

	it('only offers buildings inside the campus boundary', () => {
		const boundary = CampusBoundary.fromGeoJson(
			JSON.parse(readFileSync('static/data/campus-boundary.json', 'utf8')) as CampusBoundaryFile
		);
		for (const b of buildings) expect(boundary.contains(b.coordinates), b.name).toBe(true);
	});

	it('every offered building can be reached from the University Library in every mode', async () => {
		const failures: string[] = [];
		for (const b of buildings) {
			if (b.id === library.id) continue;
			for (const mode of MODES) {
				const response = await routeController.processRouteRequest({
					origin: { kind: 'building', buildingId: library.id },
					destination: { kind: 'building', buildingId: b.id },
					mode
				});
				if (response.status !== 'success') {
					failures.push(`${b.name} (${mode}): ${response.failure.code}`);
				}
			}
		}
		expect(failures).toEqual([]);
	}, 60_000);
});
