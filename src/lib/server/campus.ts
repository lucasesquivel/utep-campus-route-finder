import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { CampusRepository } from '../campusdata/CampusRepository';
import type { CampusDataSource } from '../campusdata/CampusDataSource';
import {
  OsmCampusTransformer,
  type OsmData
} from '../campusdata/OsmCampusTransformer';
import { RouteController } from '../controller/RouteController';
import type { Building } from '../ui/types';
import { BuildingCatalog } from './BuildingCatalog';

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
      // Approximate, unverified entrances where OSM
      // does not contain a mapped entrance.
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

const buildingCatalog = new BuildingCatalog(repository);

export const routeController = new RouteController(repository);

export async function listBuildings(): Promise<Building[]> {
  await routeController.ensureLoaded();
  return buildingCatalog.listBuildings();
}
