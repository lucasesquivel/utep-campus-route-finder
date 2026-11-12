import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CampusRepository } from '../campusdata/CampusRepository';
import type { CampusDataSource } from '../campusdata/CampusDataSource';
import { polygonCentroid } from '../campusdata/geo';
import type { RawCampusData } from '../campusdata/types';
import { RouteController } from '../controller/RouteController';
import type { Building } from '../ui/types';

/** Reads the campus data file straight from disk (the server does not need to download it). */
class DiskCampusDataSource implements CampusDataSource {
	constructor(private readonly file: string) {}

	async load(): Promise<RawCampusData> {
		return JSON.parse(await readFile(this.file, 'utf8')) as RawCampusData;
	}
}

const repository = new CampusRepository(
	new DiskCampusDataSource(path.resolve(process.cwd(), 'static/data/campus.json'))
);

/** One shared Controller for the whole server: campus data is loaded once, not per request. */
export const routeController = new RouteController(repository);

/** Buildings in the shape the page's dropdowns and map markers need. */
export async function listBuildings(): Promise<Building[]> {
	await routeController.ensureLoaded();
	const graph = repository.getGraph();
	const result: Building[] = [];
	for (const b of repository.getBuildings()) {
		let coordinates = b.centroid ?? (b.footprint ? polygonCentroid(b.footprint) : undefined);
		if (!coordinates) {
			const entrance = repository.getEntrances(b.id)[0];
			const node = entrance && graph.getNode(entrance.nodeId);
			if (node) coordinates = [node.lng, node.lat];
		}
		if (coordinates)
			result.push({ id: b.id, name: b.name, coordinates: [coordinates[0], coordinates[1]] });
	}
	return result;
}
