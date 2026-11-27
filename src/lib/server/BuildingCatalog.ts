import type { CampusBoundary } from '../campusdata/CampusBoundary';
import { CampusRepository } from '../campusdata/CampusRepository';
import { polygonCentroid } from '../campusdata/geo';
import type { Building } from '../ui/types';

/**
 * Building IDs excluded from the public campus selector even though they are inside the
 * campus boundary. Empty today: the boundary in static/data/campus-boundary.json already
 * leaves out neighboring businesses and distant facilities (McDonald's, Hilton Garden Inn,
 * Mesa Hills Healthcare Residence, Providence Memorial Hospital, Traffic Control Booth 1,
 * Larry K. Durham Sports Center).
 */
export const EXCLUDED_BUILDING_IDS: ReadonlySet<string> = new Set<string>();

/**
 * Provides UI-ready buildings from the loaded repository.
 *
 * Precondition:
 *   CampusRepository has successfully loaded its data.
 *
 * Postconditions:
 *   - Excluded building IDs are absent.
 *   - When a boundary is given, every returned building lies inside it.
 *   - Every returned building has finite coordinates.
 *   - Original repository data is not modified.
 */
export class BuildingCatalog {
	constructor(
		private readonly repository: CampusRepository,
		private readonly excludedIds: ReadonlySet<string> = EXCLUDED_BUILDING_IDS,
		private readonly boundary?: CampusBoundary
	) {}

	listBuildings(): Building[] {
		const graph = this.repository.getGraph();
		const result: Building[] = [];
		const seenIds = new Set<string>();

		for (const building of this.repository.getBuildings()) {
			if (this.excludedIds.has(building.id) || seenIds.has(building.id)) {
				continue;
			}

			let coordinates =
				building.centroid ?? (building.footprint ? polygonCentroid(building.footprint) : undefined);

			if (!coordinates) {
				const entrance = this.repository.getEntrances(building.id)[0];
				const node = entrance && graph.getNode(entrance.nodeId);

				if (node) {
					coordinates = [node.lng, node.lat];
				}
			}

			if (!coordinates || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) {
				continue;
			}

			if (this.boundary && !this.boundary.contains(coordinates)) {
				continue;
			}

			seenIds.add(building.id);

			result.push({
				id: building.id,
				name: building.name,
				coordinates: [coordinates[0], coordinates[1]]
			});
		}

		return result;
	}
}
