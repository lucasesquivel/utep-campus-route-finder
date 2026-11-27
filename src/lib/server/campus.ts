import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { CampusBoundary, type CampusBoundaryFile } from '../campusdata/CampusBoundary';
import { applyCorrections, type CampusCorrections } from '../campusdata/CampusCorrections';
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
import { BuildingCatalog, EXCLUDED_BUILDING_IDS } from './BuildingCatalog';

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

    // Team-verified fixes (entrances, missing connections, observed accessibility) are kept
    // in their own file so the OSM export stays untouched.
    const correctionsFile = path.resolve(
      process.cwd(),
      'static/data/campus-corrections.json'
    );
    const data = applyCorrections(
      result.data,
      JSON.parse(await readFile(correctionsFile, 'utf8')) as CampusCorrections
    );

    console.log(
      `Loaded ${data.buildings.length} OSM buildings, ` +
      `${data.nodes.length} nodes, ` +
      `${data.edges.length} edges, ` +
      `${data.entrances.length} entrances`
    );

    return data;
  }
}

const repository = new CampusRepository(
  new CachingCampusDataSource(
    new DiskOsmCampusDataSource()
  )
);

// Supported inner-campus area: buildings outside it are not offered in the selector.
const campusBoundary = CampusBoundary.fromGeoJson(
  JSON.parse(
    readFileSync(path.resolve(process.cwd(), 'static/data/campus-boundary.json'), 'utf8')
  ) as CampusBoundaryFile
);

const buildingCatalog = new BuildingCatalog(repository, EXCLUDED_BUILDING_IDS, campusBoundary);

export const routeController = new RouteController(repository);

export async function listBuildings(): Promise<Building[]> {
  await routeController.ensureLoaded();
  return buildingCatalog.listBuildings();
}
