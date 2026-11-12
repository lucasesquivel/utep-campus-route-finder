// Shared & Boundary Types for Application / Controller
import type { Route } from '../routing/Route';

export type RouteMode = 'shortest' | 'easy' | 'ada';

export type BuildingId = string;
export type NodeId = string;
export type LngLat = [number, number];

export type LocationSelection =
	{ kind: 'building'; buildingId: BuildingId } | { kind: 'mapPoint'; location: LngLat };

export type RouteSelection = {
	origin: LocationSelection;
	destination: LocationSelection;
	mode: RouteMode;
};

export type ValidationCode =
	| 'MISSING_ORIGIN'
	| 'MISSING_DESTINATION'
	| 'UNSUPPORTED_MODE'
	| 'UNKNOWN_BUILDING'
	| 'NO_ENTRANCES'
	| 'LOCATION_OFF_NETWORK'
	| 'DATA_NOT_LOADED';

export type ValidationResult =
	{ valid: true } | { valid: false; code: ValidationCode; message: string };

export type NoRouteReason = 'NO_USABLE_ORIGIN' | 'NO_USABLE_DESTINATION' | 'UNREACHABLE';

export type RouteFailureCode =
	'INVALID_REQUEST' | 'NO_ROUTE' | 'DATA_NOT_READY' | 'UNEXPECTED_ERROR';

export type RouteFailure = {
	code: RouteFailureCode;
	message: string;
	noRouteReason?: NoRouteReason;
	validationCode?: ValidationCode;
};

/** The plain-object form of a Route that the Controller hands to the rest of the app. */
export type SerializedRoute = Pick<
	Route,
	| 'mode'
	| 'origin'
	| 'destination'
	| 'nodeIds'
	| 'traversals'
	| 'coordinates'
	| 'totalDistanceM'
	| 'totalCost'
	| 'elevationGainM'
	| 'elevationLossM'
	| 'elevationComplete'
	| 'stairSegmentCount'
	| 'unverifiedAccessibilityDistanceM'
	| 'estimatedWalkTimeS'
>;

export type RouteResponse =
	{ status: 'success'; route: SerializedRoute } | { status: 'failure'; failure: RouteFailure };
