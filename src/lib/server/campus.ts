
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { CampusRepository } from '../campusdata/CampusRepository';
import type { CampusDataSource } from '../campusdata/CampusDataSource';
import {
  OsmCampusTransformer,
  type OsmData
} from '../campusdata/OsmCampusTransformer';
import { polygonCentroid } from '../campusdata/geo';
import { RouteController } from '../controller/RouteController';
import type { Building } from '../ui/types';

// Load Anthony's real OSM export from disk.
class DiskOsmCampusDataSource implements CampusDataSource {
  async load() {
    const file = path.resolve(
      process.cwd(),
      'static/data/campus-osm.json'
    );

    const raw = await readFile(file, 'utf8');
    const osm = JSON.parse(raw) as OsmData;

    const transformer = new OsmCampusTransformer({
      // Create approximate, unverified entrances where OSM
      // does not have a mapped entrance.
      fallbackEntranceDistanceM: 45
    });

    const result = transformer.transform(osm);

    console.log(
      `Loaded ${result.data.buildings.length} OSM buildings, ` +
      `${result.data.nodes.length} nodes, ` +
      `${result.data.edges.length} edges`
    );

    return result.data;
  }
}

const repository = new CampusRepository(
  new DiskOsmCampusDataSource()
);

export const routeController = new RouteController(repository);

export async function listBuildings(): Promise<Building[]> {
  await routeController.ensureLoaded();

  const graph = repository.getGraph();
  const result: Building[] = [];
  const excludedBuildingIds = new Set([
  'b537018065', // McDonald's
  'b405432420', // Hilton Garden Inn
  'b562875867', // Mesa Hills Healthcare Residence
  'b753039204', // Providence Memorial Hospital
  'b794278838' // Traffic Control Booth 1
  ]);

  for (const b of repository.getBuildings()) {
	if (excludedBuildingIds.has(b.id)) continue;
    let coordinates =
      b.centroid ??
      (b.footprint
        ? polygonCentroid(b.footprint)
        : undefined);

    if (!coordinates) {
      const entrance = repository.getEntrances(b.id)[0];
      const node = entrance && graph.getNode(entrance.nodeId);

      if (node) {
        coordinates = [node.lng, node.lat];
      }
    }

    if (coordinates) {
      result.push({
        id: b.id,
        name: b.name,
        coordinates: [coordinates[0], coordinates[1]]
      });
    }
  }

  return result;
}
