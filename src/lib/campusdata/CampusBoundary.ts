import { MalformedDataError } from './errors';
import { pointInRing } from './geo';
import type { LngLat } from './types';

/** GeoJSON Feature (or bare Polygon geometry) describing the supported campus area. */
export interface CampusBoundaryFile {
	type: 'Feature' | 'Polygon';
	properties?: { name?: string; note?: string };
	geometry?: { type: 'Polygon'; coordinates: number[][][] };
	coordinates?: number[][][];
}

/**
 * The supported inner-campus area. Buildings whose centroid lies outside it (neighboring
 * businesses, distant facilities) are kept by Campus Data as facts but are not offered to
 * users. Only the outer ring of the polygon is used; holes are not supported.
 */
export class CampusBoundary {
	readonly ring: readonly LngLat[];

	constructor(ring: readonly LngLat[]) {
		const open = isClosed(ring) ? ring.slice(0, -1) : ring;
		if (open.length < 3) {
			throw new MalformedDataError('Campus boundary needs at least three distinct points');
		}
		for (const [lng, lat] of open) {
			if (
				!Number.isFinite(lng) ||
				!Number.isFinite(lat) ||
				Math.abs(lat) > 90 ||
				Math.abs(lng) > 180
			) {
				throw new MalformedDataError(`Campus boundary has an invalid point: [${lng}, ${lat}]`);
			}
		}
		this.ring = Object.freeze(open.map(([lng, lat]) => Object.freeze([lng, lat] as const)));
	}

	/** Builds a boundary from a GeoJSON Polygon Feature or bare Polygon geometry. */
	static fromGeoJson(file: CampusBoundaryFile): CampusBoundary {
		const coordinates = file?.type === 'Feature' ? file.geometry?.coordinates : file?.coordinates;
		const geometryType = file?.type === 'Feature' ? file.geometry?.type : file?.type;
		if (
			geometryType !== 'Polygon' ||
			!Array.isArray(coordinates) ||
			!Array.isArray(coordinates[0])
		) {
			throw new MalformedDataError('Campus boundary must be a GeoJSON Polygon');
		}
		return new CampusBoundary(coordinates[0].map((p) => [p[0], p[1]] as const));
	}

	/** True when the [lng, lat] point lies inside the supported area. */
	contains(point: LngLat): boolean {
		return pointInRing(point, this.ring);
	}
}

function isClosed(ring: readonly LngLat[]): boolean {
	const first = ring[0];
	const last = ring[ring.length - 1];
	return ring.length > 1 && first[0] === last[0] && first[1] === last[1];
}
