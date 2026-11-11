/** UI-side contracts. Confirm final request/response shapes with the Controller team. */
export type RouteMode = 'shortest' | 'easy' | 'ada';
export type LngLat = [longitude: number, latitude: number];

export interface Building {
  id: string;
  name: string;
  coordinates: LngLat;
}

export interface RouteRequest {
  startBuildingId: string;
  destinationBuildingId: string;
  mode: RouteMode;
}

export interface RouteResult {
  /** Ordered [longitude, latitude] points along the walking route. */
  coordinates: LngLat[];
  distanceMeters?: number;
  estimatedMinutes?: number;
  instructions?: string[];
}

export class NoRouteError extends Error {
  constructor(message = 'No walking route is available for these selections.') {
    super(message);
    this.name = 'NoRouteError';
  }
}
