import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CampusRepository } from './CampusRepository';
import type { CampusDataSource } from './CampusDataSource';
import type { RawCampusData } from './types';

// Loads the dummy seed file used for the Increment 1 vertical slice.
const seed: CampusDataSource = {
	load: async () => JSON.parse(readFileSync('static/data/campus.json', 'utf8')) as RawCampusData
};

async function loadSeed(): Promise<CampusRepository> {
	const repo = new CampusRepository(seed);
	await repo.loadCampusData();
	return repo;
}

describe('seed campus.json (dummy data)', () => {
	it('loads through CampusRepository without validation errors', async () => {
		const repo = await loadSeed();
		expect(repo.getBuildings()).toHaveLength(7);
		expect(repo.getGraph().nodeCount).toBe(13);
	});

	it('resolves every building to at least one entrance', async () => {
		const repo = await loadSeed();
		for (const b of repo.getBuildings()) {
			expect(repo.getEntrances(b.id).length).toBeGreaterThan(0);
		}
	});

	it('has a stairs edge and an inaccessible entrance for ADA-mode demos', async () => {
		const repo = await loadSeed();
		const stairs = repo.getNeighboringPaths('n_stairs_base').find((e) => e.id === 'e_stairs')!;
		expect(stairs).toMatchObject({ hasStairs: true, isAccessible: false });
		expect(repo.getEntrances('b_eng').some((e) => !e.isAccessible)).toBe(true);
	});

	it('has a ramp edge with a positive slope going up and negative coming back', async () => {
		const repo = await loadSeed();
		const up = repo.getNeighboringPaths('n_ramp_a').find((e) => e.id === 'e_ramp_ab')!;
		const down = repo.getNeighboringPaths('n_ramp_b').find((e) => e.id === 'e_ramp_ab:rev')!;
		expect(up.hasRamp).toBe(true);
		expect(up.slopePct).toBeGreaterThan(0);
		expect(down.slopePct).toBe(0 - up.slopePct!);
	});

	it('leaves the Remote Annex disconnected so Routing can test a no-route case', async () => {
		const repo = await loadSeed();
		const node = repo.getEntrances('b_annex')[0].nodeId;
		expect(repo.getNeighboringPaths(node)).toEqual([]);
	});

	it('exposes building footprints as GeoJSON for the map', async () => {
		const repo = await loadSeed();
		const geo = repo.getBuildingsGeoJSON();
		expect(geo.features).toHaveLength(7);
		expect(geo.features[0].geometry.type).toBe('Polygon');
	});
});