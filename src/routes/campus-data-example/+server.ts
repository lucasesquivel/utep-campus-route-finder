/**
 * EXAMPLE ONLY (Campus Data subsystem): shows how the Controller is expected to obtain and
 * query a CampusRepository on the server. It contains no Controller or Routing logic; the
 * Controller team can copy the pattern into their own load function / service and delete this.
 *
 * Try it: GET /campus-data-example
 */
import { json } from '@sveltejs/kit';
import { CampusRepository, DataLoadError, MalformedDataError, StaticFileCampusDataSource } from '../../lib/campusdata/Index.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ fetch }) => {
	// Pass SvelteKit's event.fetch so the relative URL resolves to static/data/campus.json on the server.
	const repository = new CampusRepository(new StaticFileCampusDataSource('/data/campus.json', fetch));

	try {
		await repository.loadCampusData();
	} catch (err) {
		if (err instanceof DataLoadError || err instanceof MalformedDataError) {
			return json({ error: err.name, message: err.message }, { status: 500 });
		}
		throw err;
	}

	// The Controller would hand repository.getGraph() to Routing; here we only report what was loaded.
	const graph = repository.getGraph();
	return json({
		nodeCount: graph.nodeCount,
		edgeCount: graph.edgeCount,
		buildings: repository.getBuildings().map((b) => ({
			id: b.id,
			name: b.name,
			entrances: repository.getEntrances(b.id).map((e) => ({ id: e.id, nodeId: e.nodeId, isAccessible: e.isAccessible }))
		}))
	});
};
