import type { LngLat } from './types';

const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in meters between two lat/lng points. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Ray-casting point-in-polygon test for a [lng, lat] point and ring (closed or open). */
export function pointInRing(point: LngLat, ring: readonly LngLat[]): boolean {
	const [x, y] = point;
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

/**
 * Area-weighted centroid of a ring in [lng, lat] (planar approximation; fine at campus scale).
 * Falls back to the vertex average for degenerate (zero-area) rings.
 */
export function polygonCentroid(ring: readonly LngLat[]): LngLat {
	const pts =
		ring.length > 1 &&
		ring[0][0] === ring[ring.length - 1][0] &&
		ring[0][1] === ring[ring.length - 1][1]
			? ring.slice(0, -1)
			: ring;
	if (pts.length === 0) throw new RangeError('polygonCentroid needs at least one point');

	let area2 = 0;
	let cx = 0;
	let cy = 0;
	for (let i = 0; i < pts.length; i++) {
		const [x0, y0] = pts[i];
		const [x1, y1] = pts[(i + 1) % pts.length];
		const cross = x0 * y1 - x1 * y0;
		area2 += cross;
		cx += (x0 + x1) * cross;
		cy += (y0 + y1) * cross;
	}
	if (Math.abs(area2) < 1e-18) {
		const sum = pts.reduce<[number, number]>((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
		return [sum[0] / pts.length, sum[1] / pts.length];
	}
	return [cx / (3 * area2), cy / (3 * area2)];
}
