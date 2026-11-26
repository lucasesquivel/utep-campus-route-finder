import { haversineM, pointInRing, polygonCentroid } from './geo';
import { MalformedDataError } from './errors';
import type {
	AccessibilityStatus,
	LngLat,
	RawBuilding,
	RawCampusData,
	RawEdge,
	RawEntrance,
	RawNode
} from './types';

/* ---------- Minimal Overpass JSON shapes (output of `out body; >; out skel qt;`) ---------- */

export interface OsmElement {
	type: 'node' | 'way' | 'relation';
	id: number;
	lat?: number;
	lon?: number;
	nodes?: number[];
	tags?: Record<string, string>;
}

export interface OsmData {
	elements: OsmElement[];
}

export interface OsmCampusTransformOptions {
	/** Max distance (m) to snap an entrance to the nearest path node. Default 30. */
	snapDistanceM?: number;
	/**
	 * If a building has no mapped entrance, add an inferred entrance at the path node nearest
	 * its centroid, within this distance (m). Inferred entrances are unverified ('unknown').
	 * Opt-in: default 0 (disabled), so buildings without a known entrance keep none.
	 */
	fallbackEntranceDistanceM?: number;
	/** OSM `highway` values treated as walkable paths. Default DEFAULT_WALKABLE_HIGHWAYS. */
	walkableHighways?: readonly string[];
	/** Keep buildings that have no name. Default false (users cannot select them). */
	includeUnnamedBuildings?: boolean;
	/**
	 * Optional elevation source (e.g. the preprocessed DEM, see ElevationDataset) used when a
	 * node has no `ele` tag. Receives the node's coordinates and its OSM node id.
	 */
	elevationLookup?: (lat: number, lng: number, osmNodeId: number) => number | undefined;
	/**
	 * Derive a segment's slope from its endpoint elevations when OSM has no numeric `incline`.
	 * Default false: elevations are recorded on nodes, but no slope reaches Routing until the
	 * team has validated the DEM slopes.
	 */
	deriveSlopeFromElevation?: boolean;
	/** When deriving slopes, skip segments this returns false for (e.g. bridges, short segments). */
	isSlopeReliable?: (segmentId: string) => boolean;
	/** Segments this returns true for are too short for their own slope, so a longer stretch of the way is used. */
	isSlopeSmoothable?: (segmentId: string) => boolean;
	/** Minimum stretch length, in meters, for smoothing short segments. Default 15. */
	smoothingWindowM?: number;
}

export interface OsmTransformResult {
	data: RawCampusData;
	/** Non-fatal issues (skipped ways, unsnapped entrances, buildings given a fallback entrance). */
	warnings: string[];
}

/**
 * OSM `highway` values walked by default: dedicated pedestrian ways, plus campus service lanes
 * and shared cycle/living streets. On the UTEP export, adding `service` joins the last mapped
 * entrances to the main network. Public streets (residential, secondary...) stay excluded;
 * where OSM maps their sidewalks, those are separate footways and are included.
 */
export const DEFAULT_WALKABLE_HIGHWAYS: readonly string[] = Object.freeze([
	'footway',
	'path',
	'steps',
	'pedestrian',
	'corridor',
	'cycleway',
	'living_street',
	'service'
]);
const SKIPPED_ENTRANCES = new Set(['no', 'emergency', 'service']);

/**
 * Converts OpenStreetMap-derived data into the internal RawCampusData shape.
 * It records geographic facts only (distance, slope, stairs, ramps, accessibility tags);
 * routing policy (penalties, exclusions) stays in the Routing subsystem.
 *
 * Connectivity follows OSM exactly: two paths connect only where their ways share a node.
 * Paths are never joined just because they are close; missing connections belong in the
 * manually verified corrections file (see CampusCorrections). Untagged paths and entrances
 * are 'unknown', never assumed accessible.
 */
export class OsmCampusTransformer {
	private readonly snapDistanceM: number;
	private readonly fallbackEntranceDistanceM: number;
	private readonly walkableHighways: ReadonlySet<string>;
	private readonly includeUnnamedBuildings: boolean;
	private readonly elevationLookup?: OsmCampusTransformOptions['elevationLookup'];
	private readonly deriveSlopeFromElevation: boolean;
	private readonly isSlopeReliable: (segmentId: string) => boolean;
	private readonly isSlopeSmoothable: (segmentId: string) => boolean;
	private readonly smoothingWindowM: number;

	constructor(options: OsmCampusTransformOptions = {}) {
		this.snapDistanceM = options.snapDistanceM ?? 30;
		this.fallbackEntranceDistanceM = options.fallbackEntranceDistanceM ?? 0;
		this.walkableHighways = new Set(options.walkableHighways ?? DEFAULT_WALKABLE_HIGHWAYS);
		this.includeUnnamedBuildings = options.includeUnnamedBuildings ?? false;
		this.elevationLookup = options.elevationLookup;
		this.deriveSlopeFromElevation = options.deriveSlopeFromElevation ?? false;
		this.isSlopeReliable = options.isSlopeReliable ?? (() => true);
		this.isSlopeSmoothable = options.isSlopeSmoothable ?? (() => false);
		this.smoothingWindowM = options.smoothingWindowM ?? 15;
	}

	transform(osm: OsmData): OsmTransformResult {
		if (!osm || !Array.isArray(osm.elements)) {
			throw new MalformedDataError('OSM data must contain an elements array');
		}
		const warnings: string[] = [];

		// Overpass can emit the same element twice (e.g., once in a set and once via recursion).
		const seen = new Set<string>();
		const elements = osm.elements.filter((el) => {
			const key = `${el.type}${el.id}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		const osmNodes = new Map<number, OsmElement>();
		for (const el of elements) {
			if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
				osmNodes.set(el.id, el);
			}
		}
		const ways = elements.filter((el) => el.type === 'way' && Array.isArray(el.nodes));

		const { nodes, edges } = this.buildPaths(ways, osmNodes, warnings);
		const graphNodes = new Map(nodes.map((n) => [n.id, n] as const));
		const buildingInfos = this.buildBuildings(ways, osmNodes, warnings);
		const entrances = this.buildEntrances(elements, osmNodes, buildingInfos, graphNodes, warnings);

		return {
			data: {
				nodes,
				edges,
				buildings: buildingInfos.map((b) => b.building),
				entrances
			},
			warnings
		};
	}

	/* ---------- paths ---------- */

	private isWalkable(tags: Record<string, string>): boolean {
		if (!tags.highway || !this.walkableHighways.has(tags.highway)) return false;
		if (tags.foot === 'no') return false;
		if ((tags.access === 'no' || tags.access === 'private') && tags.foot !== 'yes') return false;
		return true;
	}

	private elevationOf(el: OsmElement): number | undefined {
		const ele = Number.parseFloat(el.tags?.ele ?? '');
		if (Number.isFinite(ele)) return ele;
		return this.elevationLookup?.(el.lat!, el.lon!, el.id);
	}

	private buildPaths(ways: OsmElement[], osmNodes: Map<number, OsmElement>, warnings: string[]) {
		const nodes = new Map<string, RawNode>();
		const edges: RawEdge[] = [];

		for (const way of ways) {
			const tags = way.tags ?? {};
			if (!this.isWalkable(tags)) continue;

			const refs = way.nodes!;
			if (refs.some((ref) => !osmNodes.has(ref))) {
				warnings.push(`Skipped path way ${way.id}: references a node missing from the data`);
				continue;
			}

			const hasStairs = tags.highway === 'steps';
			const hasRamp = tags.ramp === 'yes' || tags['ramp:wheelchair'] === 'yes';
			const accessibility = hasStairs ? 'inaccessible' : wheelchairStatus(tags.wheelchair);
			const taggedSlope = parseIncline(tags.incline);

			for (let i = 0; i < refs.length; i++) {
				const el = osmNodes.get(refs[i])!;
				const id = `n${el.id}`;
				if (!nodes.has(id)) {
					nodes.set(id, { id, lat: el.lat!, lng: el.lon!, elevationM: this.elevationOf(el) });
				}
			}

			const segments: PathSegment[] = [];
			for (let i = 0; i < refs.length - 1; i++) {
				if (refs[i] === refs[i + 1]) continue;
				const a = nodes.get(`n${refs[i]}`)!;
				const b = nodes.get(`n${refs[i + 1]}`)!;
				segments.push({
					id: `w${way.id}:${i}`,
					a,
					b,
					distanceM: haversineM(a.lat, a.lng, b.lat, b.lng)
				});
			}

			segments.forEach((segment, index) => {
				const slopePct =
					taggedSlope ?? (hasStairs ? undefined : this.derivedSlope(segments, index));
				edges.push({
					id: segment.id,
					fromId: segment.a.id,
					toId: segment.b.id,
					distanceM: segment.distanceM,
					slopePct,
					hasStairs,
					hasRamp,
					accessibility
				});
			});
		}
		return { nodes: [...nodes.values()], edges };
	}

	/** Slope from elevations: own grade if reliable, a 15 m stretch if only too short, else none. */
	private derivedSlope(segments: PathSegment[], index: number): number | undefined {
		if (!this.deriveSlopeFromElevation) return undefined;
		const segment = segments[index];
		if (this.isSlopeReliable(segment.id))
			return gradePercent(segment.a, segment.b, segment.distanceM);
		if (!this.isSlopeSmoothable(segment.id)) return undefined;

		const usable = (i: number) =>
			this.isSlopeReliable(segments[i].id) || this.isSlopeSmoothable(segments[i].id);
		let first = index;
		let last = index;
		let length = segment.distanceM;
		let forward = true;
		while (length < this.smoothingWindowM) {
			const canForward = last + 1 < segments.length && usable(last + 1);
			const canBackward = first > 0 && usable(first - 1);
			if (!canForward && !canBackward) return undefined;
			if ((forward && canForward) || !canBackward) {
				last++;
				length += segments[last].distanceM;
			} else {
				first--;
				length += segments[first].distanceM;
			}
			forward = !forward;
		}
		return gradePercent(segments[first].a, segments[last].b, length);
	}

	/* ---------- buildings ---------- */

	private buildBuildings(
		ways: OsmElement[],
		osmNodes: Map<number, OsmElement>,
		warnings: string[]
	) {
		const result: { building: RawBuilding; nodeIds: Set<number> }[] = [];
		for (const way of ways) {
			const tags = way.tags ?? {};
			if (!tags.building) continue;
			const refs = way.nodes!;
			if (refs.length < 4 || refs[0] !== refs[refs.length - 1]) continue;

			const name = tags.name ?? tags['name:en'] ?? tags['addr:housename'];
			if (!name && !this.includeUnnamedBuildings) continue;

			if (refs.some((ref) => !osmNodes.has(ref))) {
				warnings.push(`Skipped building way ${way.id}: references a node missing from the data`);
				continue;
			}
			const footprint: LngLat[] = refs.map((ref) => {
				const el = osmNodes.get(ref)!;
				return [el.lon!, el.lat!];
			});
			result.push({
				building: {
					id: `b${way.id}`,
					name: name ?? `Building ${way.id}`,
					footprint,
					centroid: polygonCentroid(footprint)
				},
				nodeIds: new Set(refs)
			});
		}
		return result;
	}

	/* ---------- entrances ---------- */

	private buildEntrances(
		elements: OsmElement[],
		osmNodes: Map<number, OsmElement>,
		buildings: { building: RawBuilding; nodeIds: Set<number> }[],
		graphNodes: Map<string, RawNode>,
		warnings: string[]
	): RawEntrance[] {
		const entrances: RawEntrance[] = [];
		const buildingsWithEntrance = new Set<string>();

		for (const el of elements) {
			const kind = el.tags?.entrance;
			if (el.type !== 'node' || !kind || SKIPPED_ENTRANCES.has(kind) || !osmNodes.has(el.id))
				continue;

			const owner =
				buildings.find((b) => b.nodeIds.has(el.id)) ??
				buildings.find((b) => pointInRing([el.lon!, el.lat!], b.building.footprint!));
			if (!owner) {
				warnings.push(`Entrance node ${el.id} does not belong to any kept building; skipped`);
				continue;
			}

			const target = this.snapToPath(el.lat!, el.lon!, graphNodes, this.snapDistanceM);
			if (!target) {
				warnings.push(
					`Entrance node ${el.id} is farther than ${this.snapDistanceM} m from any path; skipped`
				);
				continue;
			}

			if (target.id !== `n${el.id}`) {
				const offsetM = haversineM(el.lat!, el.lon!, target.lat, target.lng);
				warnings.push(
					`Entrance node ${el.id} is not on a mapped path; connected to nearest path node ${target.id} (${offsetM.toFixed(1)} m away)`
				);
			}
			entrances.push({
				id: `en${el.id}`,
				buildingId: owner.building.id,
				nodeId: target.id,
				accessibility: wheelchairStatus(el.tags?.wheelchair),
				source: 'mapped'
			});
			buildingsWithEntrance.add(owner.building.id);
		}

		for (const { building } of buildings) {
			if (buildingsWithEntrance.has(building.id)) continue;
			if (this.fallbackEntranceDistanceM <= 0) {
				warnings.push(`Building ${building.id} (${building.name}) has no known entrance`);
				continue;
			}
			const [lng, lat] = building.centroid!;
			const target = this.snapToPath(lat, lng, graphNodes, this.fallbackEntranceDistanceM);
			if (target) {
				entrances.push({
					id: `en_${building.id}_inferred`,
					buildingId: building.id,
					nodeId: target.id,
					accessibility: 'unknown',
					source: 'inferred'
				});
				warnings.push(
					`Building ${building.id} (${building.name}) has no mapped entrance; inferred one at ${target.id} (unverified)`
				);
			} else {
				warnings.push(
					`Building ${building.id} (${building.name}) has no entrance and no path nearby`
				);
			}
		}
		return entrances;
	}

	private snapToPath(
		lat: number,
		lng: number,
		graphNodes: Map<string, RawNode>,
		maxM: number
	): RawNode | undefined {
		let best: RawNode | undefined;
		let bestDist = Infinity;
		for (const node of graphNodes.values()) {
			const d = haversineM(lat, lng, node.lat, node.lng);
			if (d < bestDist) {
				bestDist = d;
				best = node;
			}
		}
		return best && bestDist <= maxM ? best : undefined;
	}
}

/**
 * Maps the OSM `wheelchair` tag to an accessibility status. 'limited' means only partly
 * usable, so it is recorded as 'inaccessible'; a missing or unrecognized value is 'unknown'.
 */
function wheelchairStatus(value: string | undefined): AccessibilityStatus {
	if (value === 'yes' || value === 'designated') return 'accessible';
	if (value === 'no' || value === 'limited') return 'inaccessible';
	return 'unknown';
}

/** Parses OSM `incline` values like "5%", "-3.5%", or "4°" into percent grade along the way direction. */
function parseIncline(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const pct = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(value.trim());
	if (pct) return Number.parseFloat(pct[1]);
	const deg = /^(-?\d+(?:\.\d+)?)\s*°$/.exec(value.trim());
	if (deg) return Math.round(Math.tan((Number.parseFloat(deg[1]) * Math.PI) / 180) * 10000) / 100;
	return undefined;
}

interface PathSegment {
	id: string;
	a: RawNode;
	b: RawNode;
	distanceM: number;
}

/** Rise over run in percent, rounded to 2 decimals; undefined without both elevations. */
function gradePercent(a: RawNode, b: RawNode, distanceM: number): number | undefined {
	if (a.elevationM === undefined || b.elevationM === undefined || !(distanceM > 0))
		return undefined;
	return Math.round(((b.elevationM - a.elevationM) / distanceM) * 10000) / 100;
}
