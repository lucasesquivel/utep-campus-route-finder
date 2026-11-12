// Shared & Boundary Types for Application / Controller

export type RouteMode = 'shortest' | 'easy' | 'ada';

export type BuildingId = string;
export type NodeId = string;
export type LngLat = [number, number];

export type LocationSelection = 
  | { kind: 'building'; buildingId: BuildingId } 
  | { kind: 'mapPoint'; location: LngLat };

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
  | 'LOCATION_OFF_NETWORK';

export type ValidationResult = 
  | { valid: true } 
  | { valid: false; code: ValidationCode; message: string };

export type NoRouteReason = 'NO_USABLE_ORIGIN' | 'NO_USABLE_DESTINATION' | 'UNREACHABLE';

export type RouteFailureCode = 
  | 'INVALID_REQUEST' 
  | 'NO_ROUTE' 
  | 'DATA_NOT_READY' 
  | 'UNEXPECTED_ERROR';

export type RouteFailure = {
  code: RouteFailureCode;
  message: string;
  noRouteReason?: NoRouteReason;
  validationCode?: ValidationCode;
};

export type RouteResponse = 
  | { status: 'success'; route: any } // Replace 'any' with your Routing Subsystem's Route class type
  | { status: 'failure'; failure: RouteFailure };