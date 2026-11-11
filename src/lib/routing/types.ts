/**
 * Routing-boundary types (SDD 5.2.1 RT-1, 5.7.1 RO-1). The Application / Controller builds
 * RouteRequest and consumes RouteResult; the UI never sees these types directly.
 */
import type { LngLat, RouteMode } from '../shared/types';
import type { EntranceView, NodeId, PathTraversalView } from './campusDataView';
import type { Route } from './Route';

export type { RouteMode } from '../shared/types';

/**
 * One candidate start or end of a route. The Controller makes one endpoint per entrance of
 * a selected building (CD-4), or one endpoint for a map point snapped to a node (CG-5).
 * When entrance is present, entrance.nodeId must equal nodeId.
 */
export interface RouteEndpoint {
	readonly nodeId: NodeId;
	readonly entrance?: EntranceView;
}

/** Input to RT-1 Calculate Route. */
export interface RouteRequest {
	readonly mode: RouteMode;
	readonly origins: readonly RouteEndpoint[];
	readonly destinations: readonly RouteEndpoint[];
}

/** Why no route was found. A normal result, not an error. */
export type NoRouteReason = 'NO_USABLE_ORIGIN' | 'NO_USABLE_DESTINATION' | 'UNREACHABLE';

export interface FoundRouteResult {
	readonly status: 'found';
	readonly route: Route;
}

export interface NoRouteResult {
	readonly status: 'no-route';
	readonly mode: RouteMode;
	readonly reason: NoRouteReason;
}

/** Output of RT-1 Calculate Route. */
export type RouteResult = FoundRouteResult | NoRouteResult;

/** Input to RO-1 Construct Route Result (Route.build). */
export interface RouteBuildInput {
	readonly mode: RouteMode;
	readonly origin: RouteEndpoint;
	readonly destination: RouteEndpoint;
	/** Location of origin.nodeId; first coordinate of the route geometry. */
	readonly originLocation: LngLat;
	/** Traversals in travel order, forming a chain from origin to destination. */
	readonly traversals: readonly PathTraversalView[];
	readonly totalCost: number;
}
