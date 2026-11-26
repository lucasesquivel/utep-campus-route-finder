import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { CampusRepository } from '../campusdata/CampusRepository';
import type { CampusDataSource } from '../campusdata/CampusDataSource';
import { CachingCampusDataSource } from '../campusdata/CachingCampusDataSource';
import { ElevationDataset, type ElevationFile } from '../campusdata/ElevationDataset';
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

    // USGS 1 m DEM elevations preprocessed by scripts/preprocess-dem.ts.
    // Slopes stay disabled (false) until the DEM slopes are validated.
    const elevationFile = path.resolve(
      process.cwd(),
      'static/data/campus-elevation.json'
    );
    const elevation = new ElevationDataset(
      JSON.parse(await readFile(elevationFile, 'utf8')) as ElevationFile
    );

    const transformer = new OsmCampusTransformer({
      // Approximate, unverified entrances where OSM
      // does not contain a mapped entrance.
      fallbackEntranceDistanceM: 45,
      ...elevation.transformOptions(false)
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
  new CachingCampusDataSource(
    new DiskOsmCampusDataSource()
  )
);

const buildingCatalog = new BuildingCatalog(repository);

export const routeController = new RouteController(repository);

export async function listBuildings(): Promise<Building[]> {
  await routeController.ensureLoaded();
  return buildingCatalog.listBuildings();
}
