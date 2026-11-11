import { CampusGraph } from './CampusGraph';
import type { CampusDataSource } from './CampusDataSource';
import { CampusDataError, DataLoadError, MalformedDataError, NotFoundError } from './errors';
import { RoutingGraphAdapter } from './RoutingGraphAdapter';
import type {
	AccessibilityStatus,
	Building,
	BuildingFeatureCollection,
	Entrance,
	EntranceSource,
	GraphNode,
	LngLat,
	PathEdge,
	RawBuilding,
	RawCampusData,
	RawEntrance,
	RoutingEntrance
} from './types';

const ACCESSIBILITY_STATUSES: ReadonlySet<string> = new Set<AccessibilityStatus>([
	'accessible',
	'inaccessible',
	'unknown'
]);
const ENTRANCE_SOURCES: ReadonlySet<string> = new Set<EntranceSource>([
	'mapped',
	'verified',
	'inferred'
]);

/**
 * Public entry point of the Campus Data subsystem.
 * The Controller uses getBuilding()/getEntrances() and passes getRoutingGraph() and
 * getRoutingEntrances() to Routing's RouteEngine.
 */
export class CampusRepository {
	private readonly source: CampusDataSource;
	private graph = new CampusGraph([], []);
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

	/** The graph in the shape Routing's RouteEngine reads (CG-2 / CG-3). */
	getRoutingGraph(): RoutingGraphAdapter {
		this.assertLoaded();
		return new RoutingGraphAdapter(this.graph);
	}

	/** Entrances of a building in the shape Routing reads. Throws NotFoundError if unknown. */
	getRoutingEntrances(buildingId: string): RoutingEntrance[] {
		return this.getEntrances(buildingId).map(RoutingGraphAdapter.toRoutingEntrance);
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

	/** Outgoing edges from a node (frozen). Throws NotFoundError for an unknown node. */
	getNeighboringPaths(nodeId: string): readonly PathEdge[] {
		this.assertLoaded();
		return this.graph.getNeighbors(nodeId);
	}

	private assertLoaded(): void {
		if (!this.loaded) throw new DataLoadError('Campus data has not been loaded');
	}

	private static validateGeometry(b: RawBuilding): void {
		const isPoint = (p: unknown): boolean =>
			Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
		if (
			b.footprint !== undefined &&
			(!Array.isArray(b.footprint) || b.footprint.length < 4 || !b.footprint.every(isPoint))
		) {
			throw new MalformedDataError(`Building ${b.id} has an invalid footprint`);
		}
		if (b.centroid !== undefined && !isPoint(b.centroid)) {
			throw new MalformedDataError(`Building ${b.id} has an invalid centroid`);
		}
	}

	/** Validates a raw entrance's accessibility and source, applying defaults, and freezes it. */
	private static buildEntrance(en: RawEntrance): Entrance {
		CampusRepository.rejectLegacyAccessibility(en, `Entrance ${en.id}`);
		const accessibility = en.accessibility ?? 'unknown';
		const source = en.source ?? 'mapped';
		if (!ACCESSIBILITY_STATUSES.has(accessibility)) {
			throw new MalformedDataError(`Entrance ${en.id} has invalid accessibility: ${accessibility}`);
		}
		if (!ENTRANCE_SOURCES.has(source)) {
			throw new MalformedDataError(`Entrance ${en.id} has invalid source: ${source}`);
		}
		if (source === 'inferred' && accessibility !== 'unknown') {
			throw new MalformedDataError(`Inferred entrance ${en.id} must have unknown accessibility`);
		}
		return Object.freeze({
			id: en.id,
			buildingId: en.buildingId,
			nodeId: en.nodeId,
			accessibility,
			source
		});
	}

	/** The old boolean field silently meant "accessible"; fail loudly so stale files get migrated. */
	private static rejectLegacyAccessibility(record: object, label: string): void {
		if ('isAccessible' in record) {
			throw new MalformedDataError(
				`${label} uses the removed isAccessible field; use accessibility: 'accessible' | 'inaccessible' | 'unknown'`
			);
		}
	}

	private static freezePoint(point: LngLat): LngLat {
		return Object.freeze([point[0], point[1]] as const);
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
			throw new MalformedDataError(
				'Campus data must contain nodes, edges, buildings, and entrances arrays'
			);
		}

		const nodes: GraphNode[] = raw.nodes.map((n) => ({
			id: n.id,
			lat: n.lat,
			lng: n.lng,
			elevationM: n.elevationM
		}));

		const edges: PathEdge[] = [];
		for (const e of raw.edges) {
			CampusRepository.rejectLegacyAccessibility(e, `Edge ${e.id}`);
			const hasStairs = e.hasStairs ?? false;
			const forward: PathEdge = {
				id: e.id,
				fromId: e.fromId,
				toId: e.toId,
				distanceM: e.distanceM,
				slopePct: e.slopePct,
				hasStairs,
				hasRamp: e.hasRamp ?? false,
				accessibility: e.accessibility ?? (hasStairs ? 'inaccessible' : 'unknown')
			};
			edges.push(forward);
			if (e.bidirectional !== false) {
				edges.push({
					...forward,
					id: `${e.id}:rev`,
					fromId: e.toId,
					toId: e.fromId,
					slopePct: e.slopePct === undefined ? undefined : 0 - e.slopePct
				});
			}
		}
		const graph = new CampusGraph(nodes, edges);

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
				throw new MalformedDataError(
					`Entrance ${en.id} references unknown building: ${en.buildingId}`
				);
			}
			if (!graph.hasNode(en.nodeId)) {
				throw new MalformedDataError(`Entrance ${en.id} references unknown node: ${en.nodeId}`);
			}
			entrances.set(en.id, CampusRepository.buildEntrance(en));
			entranceIdsByBuilding.get(en.buildingId)!.push(en.id);
		}

		const buildings = new Map<string, Building>();
		for (const b of raw.buildings) {
			buildings.set(
				b.id,
				Object.freeze({
					id: b.id,
					name: b.name,
					entranceIds: Object.freeze(entranceIdsByBuilding.get(b.id)!),
					footprint: b.footprint && Object.freeze(b.footprint.map(CampusRepository.freezePoint)),
					centroid: b.centroid && CampusRepository.freezePoint(b.centroid)
				})
			);
		}

		return { graph, buildings, entrances };
	}
}
