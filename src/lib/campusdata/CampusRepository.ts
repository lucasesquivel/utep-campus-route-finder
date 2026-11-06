import { CampusGraph } from './CampusGraph';
import type { CampusDataSource } from './CampusDataSource';
import { CampusDataError, DataLoadError, MalformedDataError, NotFoundError } from './errors';
import type { Building, BuildingFeatureCollection, Entrance, PathEdge, RawBuilding, RawCampusData } from './types';

/**
 * Public entry point of the Campus Data subsystem.
 * Routing uses getGraph()/getNeighboringPaths(); the Controller uses getBuilding()/getEntrances().
 */
export class CampusRepository {
	private readonly source: CampusDataSource;
	private graph = new CampusGraph();
	private buildings = new Map<string, Building>();
	private entrances = new Map<string, Entrance>();
	private loaded = false;

	constructor(source: CampusDataSource) {
		this.source = source;
	}

	/**
	 * Loads, validates, and builds the internal representation.
	 * Existing data is only replaced if the whole load succeeds.
	 */
	async loadCampusData(): Promise<void> {
		let raw: RawCampusData;
		try {
			raw = await this.source.load();
		} catch (err) {
			if (err instanceof CampusDataError) throw err;
			throw new DataLoadError(`Campus data source failed: ${String(err)}`);
		}

		const built = CampusRepository.build(raw);
		this.graph = built.graph;
		this.buildings = built.buildings;
		this.entrances = built.entrances;
		this.loaded = true;
	}

	getGraph(): CampusGraph {
		this.assertLoaded();
		return this.graph;
	}

	getBuilding(id: string): Building | undefined {
		this.assertLoaded();
		return this.buildings.get(id);
	}

	getBuildings(): Building[] {
		this.assertLoaded();
		return [...this.buildings.values()];
	}

	/** Building footprints as GeoJSON for MapLibre. Buildings without a footprint are omitted. */
	getBuildingsGeoJSON(): BuildingFeatureCollection {
		this.assertLoaded();
		const features: BuildingFeatureCollection['features'] = [];
		for (const b of this.buildings.values()) {
			if (!b.footprint) continue;
			features.push({
				type: 'Feature',
				id: b.id,
				properties: { id: b.id, name: b.name },
				geometry: { type: 'Polygon', coordinates: [[...b.footprint]] }
			});
		}
		return { type: 'FeatureCollection', features };
	}

	/** Entrances of a building. Throws NotFoundError for an unknown building; [] if it has none. */
	getEntrances(buildingId: string): Entrance[] {
		this.assertLoaded();
		const building = this.buildings.get(buildingId);
		if (!building) throw new NotFoundError(`Unknown building: ${buildingId}`);
		return building.entranceIds.map((id) => this.entrances.get(id)!);
	}

	/** Outgoing edges from a node. Throws NotFoundError for an unknown node. */
	getNeighboringPaths(nodeId: string): PathEdge[] {
		this.assertLoaded();
		return this.graph.getNeighbors(nodeId);
	}

	private assertLoaded(): void {
		if (!this.loaded) throw new DataLoadError('Campus data has not been loaded');
	}

	private static validateGeometry(b: RawBuilding): void {
		const isPoint = (p: unknown): boolean =>
			Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
		if (b.footprint !== undefined && (!Array.isArray(b.footprint) || b.footprint.length < 4 || !b.footprint.every(isPoint))) {
			throw new MalformedDataError(`Building ${b.id} has an invalid footprint`);
		}
		if (b.centroid !== undefined && !isPoint(b.centroid)) {
			throw new MalformedDataError(`Building ${b.id} has an invalid centroid`);
		}
	}

	/** Validates raw data and transforms it into the internal representation. */
	private static build(raw: RawCampusData) {
		if (
			!raw ||
			!Array.isArray(raw.nodes) ||
			!Array.isArray(raw.edges) ||
			!Array.isArray(raw.buildings) ||
			!Array.isArray(raw.entrances)
		) {
			throw new MalformedDataError('Campus data must contain nodes, edges, buildings, and entrances arrays');
		}

		const graph = new CampusGraph();

		for (const n of raw.nodes) {
			graph.addNode({ id: n.id, lat: n.lat, lng: n.lng, elevationM: n.elevationM });
		}

		for (const e of raw.edges) {
			const forward: PathEdge = {
				id: e.id,
				fromId: e.fromId,
				toId: e.toId,
				distanceM: e.distanceM,
				slopePct: e.slopePct,
				hasStairs: e.hasStairs ?? false,
				hasRamp: e.hasRamp ?? false,
				isAccessible: e.isAccessible ?? true
			};
			graph.addEdge(forward);
			if (e.bidirectional !== false) {
				graph.addEdge({
					...forward,
					id: `${e.id}:rev`,
					fromId: e.toId,
					toId: e.fromId,
					slopePct: e.slopePct === undefined ? undefined : 0 - e.slopePct
				});
			}
		}

		const entrances = new Map<string, Entrance>();
		const entranceIdsByBuilding = new Map<string, string[]>();
		const buildingIds = new Set<string>();

		for (const b of raw.buildings) {
			if (!b.id) throw new MalformedDataError('Building is missing an id');
			if (buildingIds.has(b.id)) throw new MalformedDataError(`Duplicate building id: ${b.id}`);
			CampusRepository.validateGeometry(b);
			buildingIds.add(b.id);
			entranceIdsByBuilding.set(b.id, []);
		}

		for (const en of raw.entrances) {
			if (!en.id) throw new MalformedDataError('Entrance is missing an id');
			if (entrances.has(en.id)) throw new MalformedDataError(`Duplicate entrance id: ${en.id}`);
			if (!buildingIds.has(en.buildingId)) {
				throw new MalformedDataError(`Entrance ${en.id} references unknown building: ${en.buildingId}`);
			}
			if (!graph.hasNode(en.nodeId)) {
				throw new MalformedDataError(`Entrance ${en.id} references unknown node: ${en.nodeId}`);
			}
			entrances.set(en.id, {
				id: en.id,
				buildingId: en.buildingId,
				nodeId: en.nodeId,
				isAccessible: en.isAccessible ?? true
			});
			entranceIdsByBuilding.get(en.buildingId)!.push(en.id);
		}

		const buildings = new Map<string, Building>();
		for (const b of raw.buildings) {
			buildings.set(b.id, {
				id: b.id,
				name: b.name,
				entranceIds: entranceIdsByBuilding.get(b.id)!,
				footprint: b.footprint,
				centroid: b.centroid
			});
		}

		return { graph, buildings, entrances };
	}
}