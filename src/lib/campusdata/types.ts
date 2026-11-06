/**
 * Internal campus representation (facts only).
 * Entities reference each other by string ID to avoid circular object graphs
 * and to keep JSON loading simple. Route-mode costs belong to Routing, not here.
 */

export interface GraphNode {
	readonly id: string;
	readonly lat: number;
	readonly lng: number;
	/** Elevation in meters above sea level, if known. */
	readonly elevationM?: number;
}

export interface PathEdge {
	readonly id: string;
	readonly fromId: string;
	readonly toId: string;
	/** Length of the path segment in meters (>= 0). */
	readonly distanceM: number;
	/** Percent grade in the from -> to direction (positive = uphill), if known. */
	readonly slopePct?: number;
	readonly hasStairs: boolean;
	readonly hasRamp: boolean;
	readonly isAccessible: boolean;
}

/** [longitude, latitude] pair (GeoJSON order, as MapLibre expects). */
export type LngLat = [number, number];

export interface Building {
	readonly id: string;
	readonly name: string;
	readonly entranceIds: readonly string[];
	/** Outline ring (closed: first point repeated last), for drawing on the map. */
	readonly footprint?: readonly LngLat[];
	readonly centroid?: LngLat;
}

/** GeoJSON of building footprints, ready for a MapLibre `geojson` source. */
export interface BuildingFeatureCollection {
	type: 'FeatureCollection';
	features: {
		type: 'Feature';
		id: string;
		properties: { id: string; name: string };
		geometry: { type: 'Polygon'; coordinates: LngLat[][] };
	}[];
}

export interface Entrance {
	readonly id: string;
	readonly buildingId: string;
	/** Graph node where this entrance connects to the path network. */
	readonly nodeId: string;
	readonly isAccessible: boolean;
}

/* ---------- Routing-facing shapes (SDD CG-2 / CG-3 / CD-4), produced by RoutingGraphAdapter ---------- */

/** Accessibility of a path or entrance. 'unknown' means the source data does not say. */
export type AccessibilityStatus = 'accessible' | 'inaccessible' | 'unknown';

export interface AccessibilityInfo {
	readonly status: AccessibilityStatus;
}

/** A graph node as Routing reads it (CG-2). */
export interface RoutingNode {
	readonly id: string;
	readonly location: LngLat;
}

/** One directed path segment as Routing reads it. Facts only; costs belong to Routing. */
export interface RoutingEdge {
	readonly id: string;
	readonly fromNodeId: string;
	readonly toNodeId: string;
	/** 'steps' for a staircase, otherwise 'path'. */
	readonly kind: string;
	/** Points from fromNodeId to toNodeId, in [lng, lat] order. */
	readonly geometry: readonly LngLat[];
	readonly hasStairs: boolean | null;
	/** Number of steps, or null when unknown. */
	readonly stepCount: number | null;
	readonly hasRamp: boolean;
	readonly accessibility: AccessibilityInfo;
}

/** A path resolved for one direction of travel (CG-3). Signed values are null when unknown. */
export interface PathTraversal {
	readonly edge: RoutingEdge;
	readonly fromNodeId: string;
	readonly toNodeId: string;
	readonly distanceM: number;
	readonly elevationChangeM: number | null;
	readonly gradePercent: number | null;
}

/** A building entrance as Routing reads it (CD-4). */
export interface RoutingEntrance {
	readonly id: string;
	readonly buildingId: string;
	readonly nodeId: string;
	/** Whether the entrance has steps, or null when unknown. */
	readonly hasSteps: boolean | null;
	readonly accessibility: AccessibilityInfo;
}

/* ---------- Raw (OSM-derived / file) shapes returned by a CampusDataSource ---------- */

export interface RawNode {
	id: string;
	lat: number;
	lng: number;
	elevationM?: number;
}

export interface RawEdge {
	id: string;
	fromId: string;
	toId: string;
	distanceM: number;
	slopePct?: number;
	hasStairs?: boolean;
	hasRamp?: boolean;
	isAccessible?: boolean;
	/** Defaults to true: a reverse edge (negated slope) is created on load. */
	bidirectional?: boolean;
}

export interface RawBuilding {
	id: string;
	name: string;
	footprint?: LngLat[];
	centroid?: LngLat;
}

export interface RawEntrance {
	id: string;
	buildingId: string;
	nodeId: string;
	isAccessible?: boolean;
}

export interface RawCampusData {
	nodes: RawNode[];
	edges: RawEdge[];
	buildings: RawBuilding[];
	entrances: RawEntrance[];
}