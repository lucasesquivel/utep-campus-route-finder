/**
 * Types shared by more than one subsystem (SDD Sections 2, 3.1, 5.1).
 */

/** Every routing mode the system knows about, in display order. */
export const ROUTE_MODES = ['shortest', 'easy', 'ada'] as const;

/**
 * Routing mode selected by the user. Shared cross-subsystem type: used by the UI,
 * the Application / Controller and Routing.
 */
export type RouteMode = (typeof ROUTE_MODES)[number];

/** WGS84 coordinate in GeoJSON / MapLibre order: [longitude, latitude] in degrees. */
export type LngLat = readonly [lng: number, lat: number];
