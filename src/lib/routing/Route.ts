import type { Feature, LineString, Position } from 'geojson';
import type { LngLat, RouteMode } from '../shared/types';
import { edgeHasStairs, type NodeId, type PathTraversalView } from './campusDataView';
import type { RouteBuildInput, RouteEndpoint } from './types';

/** Average walking speed used for estimatedWalkTimeS (RO-1). */
export const WALKING_SPEED_MPS = 1.3;

/** GeoJSON properties attached by Route.toGeoJson(). */
export interface RouteGeoJsonProperties {
	mode: RouteMode;
	totalDistanceM: number;
	estimatedWalkTimeS: number;
	stairSegmentCount: number;
	unverifiedAccessibilityDistanceM: number;
}

/**
 * Immutable result of a successful search (SDD 5.7): the ordered path, its geometry for
 * display, and summary facts. Holds plain data and does not depend on MapLibre.
 *
 * Increment 1 displays totalDistanceM and estimatedWalkTimeS; the other summary fields
 * support Increment 2 route information.
 */
export class Route {
	readonly mode: RouteMode;
	readonly origin: RouteEndpoint;
	readonly destination: RouteEndpoint;
	/** Visited node ids in travel order; traversals.length + 1 entries. */
	readonly nodeIds: readonly NodeId[];
	/** Paths in travel order, each resolved for its direction of travel. */
	readonly traversals: readonly PathTraversalView[];
	/** Route geometry in travel order with no repeated joint points. */
	readonly coordinates: readonly LngLat[];
	readonly totalDistanceM: number;
	/** Strategy cost of the route in meter-equivalents (>= totalDistanceM). */
	readonly totalCost: number;
	/** Sum of known positive elevation changes. */
	readonly elevationGainM: number;
	/** Sum of known negative elevation changes, as a positive number. */
	readonly elevationLossM: number;
	/** False if any traversal's elevation change is unknown. */
	readonly elevationComplete: boolean;
	/** Number of traversals whose edge has stairs. */
	readonly stairSegmentCount: number;
	/**
	 * Distance over paths whose accessibility status is unknown. The UI should warn the user
	 * when this is above 0, especially in ADA mode, which allows unknown paths (see
	 * AdaRouteStrategy). It does not cover unknown entrances; those are on origin/destination.
	 */
	readonly unverifiedAccessibilityDistanceM: number;
	/** totalDistanceM / WALKING_SPEED_MPS. */
	readonly estimatedWalkTimeS: number;

	private constructor(fields: Omit<Route, 'toGeoJson'>) {
		this.mode = fields.mode;
		this.origin = fields.origin;
		this.destination = fields.destination;
		this.nodeIds = fields.nodeIds;
		this.traversals = fields.traversals;
		this.coordinates = fields.coordinates;
		this.totalDistanceM = fields.totalDistanceM;
		this.totalCost = fields.totalCost;
		this.elevationGainM = fields.elevationGainM;
		this.elevationLossM = fields.elevationLossM;
		this.elevationComplete = fields.elevationComplete;
		this.stairSegmentCount = fields.stairSegmentCount;
		this.unverifiedAccessibilityDistanceM = fields.unverifiedAccessibilityDistanceM;
		this.estimatedWalkTimeS = fields.estimatedWalkTimeS;
		Object.freeze(this);
	}

	/**
	 * RO-1 Construct Route Result.
	 *
	 * Pre: traversals form a chain from origin.nodeId to destination.nodeId (or are empty
	 * and origin.nodeId equals destination.nodeId); totalCost >= 0.
	 * Post: a frozen Route whose arrays are frozen. Throws RangeError if a precondition is
	 * violated.
	 */
	static build(input: RouteBuildInput): Route {
		const { mode, origin, destination, originLocation, totalCost } = input;
		const traversals = Object.freeze([...input.traversals]);

		// 1. Check the chain and totalCost.
		const nodeIds = Route.checkChain(origin.nodeId, destination.nodeId, traversals);
		if (!(totalCost >= 0) || !Number.isFinite(totalCost)) {
			throw new RangeError(`totalCost must be a finite number >= 0, got ${totalCost}`);
		}

		// 2. Join the geometry in the direction of travel.
		const coordinates = Route.joinGeometry(originLocation, traversals);

		// 3. One pass over the traversals for the totals.
		let totalDistanceM = 0;
		let elevationGainM = 0;
		let elevationLossM = 0;
		let elevationComplete = true;
		let stairSegmentCount = 0;
		let unverifiedAccessibilityDistanceM = 0;
		for (const t of traversals) {
			totalDistanceM += t.distanceM;
			const change = t.elevationChangeM;
			if (change === null || !Number.isFinite(change)) {
				elevationComplete = false;
			} else if (change > 0) {
				elevationGainM += change;
			} else {
				elevationLossM -= change;
			}
			if (edgeHasStairs(t.edge)) stairSegmentCount += 1;
			if (t.edge.accessibility.status === 'unknown') {
				unverifiedAccessibilityDistanceM += t.distanceM;
			}
		}

		// 4. Freeze and return.
		return new Route({
			mode,
			origin,
			destination,
			nodeIds,
			traversals,
			coordinates,
			totalDistanceM,
			totalCost,
			elevationGainM,
			elevationLossM,
			elevationComplete,
			stairSegmentCount,
			unverifiedAccessibilityDistanceM,
			estimatedWalkTimeS: totalDistanceM / WALKING_SPEED_MPS
		});
	}

	/**
	 * GeoJSON LineString feature that MapLibre can draw directly. A zero-length route has a
	 * single coordinate; it is emitted twice so the LineString stays valid (GeoJSON requires
	 * at least two positions).
	 */
	toGeoJson(): Feature<LineString, RouteGeoJsonProperties> {
		const positions: Position[] = this.coordinates.map(([lng, lat]) => [lng, lat]);
		if (positions.length === 1) positions.push([...positions[0]]);
		return {
			type: 'Feature',
			geometry: { type: 'LineString', coordinates: positions },
			properties: {
				mode: this.mode,
				totalDistanceM: this.totalDistanceM,
				estimatedWalkTimeS: this.estimatedWalkTimeS,
				stairSegmentCount: this.stairSegmentCount,
				unverifiedAccessibilityDistanceM: this.unverifiedAccessibilityDistanceM
			}
		};
	}

	/** Verifies the chain precondition and returns the visited node ids. */
	private static checkChain(
		originId: NodeId,
		destinationId: NodeId,
		traversals: readonly PathTraversalView[]
	): readonly NodeId[] {
		const nodeIds: NodeId[] = [originId];
		let current = originId;
		traversals.forEach((t, i) => {
			if (t.fromNodeId !== current) {
				throw new RangeError(
					`Route chain broken at traversal ${i}: expected fromNodeId ${current}, got ${t.fromNodeId}`
				);
			}
			current = t.toNodeId;
			nodeIds.push(current);
		});
		if (current !== destinationId) {
			throw new RangeError(
				`Route chain ends at node ${current}, but destination is node ${destinationId}`
			);
		}
		return Object.freeze(nodeIds);
	}

	/**
	 * Starts at originLocation and appends each edge's geometry oriented for the direction
	 * of travel, skipping a first point that repeats the last point appended.
	 */
	private static joinGeometry(
		originLocation: LngLat,
		traversals: readonly PathTraversalView[]
	): readonly LngLat[] {
		const coordinates: LngLat[] = [Route.copyPoint(originLocation)];
		for (const t of traversals) {
			const stored = t.edge.geometry;
			const reversed = t.fromNodeId !== t.edge.fromNodeId;
			const n = stored.length;
			for (let k = 0; k < n; k++) {
				const point = stored[reversed ? n - 1 - k : k];
				const last = coordinates[coordinates.length - 1];
				if (k === 0 && point[0] === last[0] && point[1] === last[1]) continue;
				coordinates.push(Route.copyPoint(point));
			}
		}
		return Object.freeze(coordinates);
	}

	private static copyPoint(point: LngLat): LngLat {
		return Object.freeze([point[0], point[1]] as const);
	}
}
