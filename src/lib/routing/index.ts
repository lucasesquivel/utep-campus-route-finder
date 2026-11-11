/**
 * Public surface of the Routing subsystem (SDD Section 5). The Application / Controller
 * imports from here; MinPriorityQueue stays internal.
 */
export { RouteEngine } from './RouteEngine';
export { Route, WALKING_SPEED_MPS, type RouteGeoJsonProperties } from './Route';
export { type RoutingStrategy } from './RoutingStrategy';
export { ShortestRouteStrategy } from './ShortestRouteStrategy';
export { EasyRouteStrategy } from './EasyRouteStrategy';
export { AdaRouteStrategy } from './AdaRouteStrategy';
export { RouteRequestError, type RouteRequestErrorCode } from './errors';
export type {
	RouteMode,
	RouteEndpoint,
	RouteRequest,
	RouteResult,
	FoundRouteResult,
	NoRouteResult,
	NoRouteReason,
	RouteBuildInput
} from './types';
export type {
	CampusGraphView,
	NodeId,
	GraphNodeView,
	PathEdgeView,
	PathTraversalView,
	EntranceView,
	AccessibilityView,
	AccessibilityStatus
} from './campusDataView';
