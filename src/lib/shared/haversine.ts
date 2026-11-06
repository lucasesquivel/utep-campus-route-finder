import type { LngLat } from './types';

/** Mean Earth radius in meters (IUGG). */
export const EARTH_RADIUS_M = 6_371_008.8;

const DEG_TO_RAD = Math.PI / 180;

/**
 * Great-circle distance in meters between two WGS84 [lng, lat] coordinates.
 *
 * Shared stateless helper (SDD 5.2 comments): Routing uses it for the A* heuristic and
 * Campus Data uses it for edge distances and nearest-node lookup.
 */
export function haversineDistanceM(a: LngLat, b: LngLat): number {
	const [lng1, lat1] = a;
	const [lng2, lat2] = b;
	const phi1 = lat1 * DEG_TO_RAD;
	const phi2 = lat2 * DEG_TO_RAD;
	const dPhi = (lat2 - lat1) * DEG_TO_RAD;
	const dLambda = (lng2 - lng1) * DEG_TO_RAD;

	const chordTerm =
		Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
	// Clamp guards against floating-point drift slightly above 1 for antipodal points.
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(chordTerm)));
}
