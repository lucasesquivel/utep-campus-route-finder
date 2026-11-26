import { MalformedDataError } from './errors';
import type { OsmCampusTransformOptions } from './OsmCampusTransformer';

/**
 * Why a path segment's slope, computed from the DEM, should not be trusted yet:
 * - structure: bridge, tunnel, covered or indoor way; the bare-earth DEM is not its surface
 * - short-segment: so short that DEM vertical error dominates the grade
 * - terrain-discontinuity: a wall, curb or building edge next to an endpoint
 * - irregular-profile: the ground between the endpoints is not a straight incline
 * - steep-needs-validation: a non-stair grade too steep to accept without a field check
 * - missing-elevation: an endpoint has no DEM value
 */
export type SlopeIssue =
	| 'structure'
	| 'short-segment'
	| 'terrain-discontinuity'
	| 'irregular-profile'
	| 'steep-needs-validation'
	| 'missing-elevation';

const SLOPE_ISSUES: ReadonlySet<string> = new Set<SlopeIssue>([
	'structure',
	'short-segment',
	'terrain-discontinuity',
	'irregular-profile',
	'steep-needs-validation',
	'missing-elevation'
]);

export const ELEVATION_FILE_FORMAT = 'utep-campus-elevation/1';

/** On-disk format written by scripts/preprocess-dem.ts (static/data/campus-elevation.json). */
export interface ElevationFile {
	format: typeof ELEVATION_FILE_FORMAT;
	/** Provenance of the DEM and of the OSM export the values were sampled for. */
	source: Record<string, string | number>;
	/** Elevation in meters (NAVD88) by OSM node id. */
	elevationsM: Record<string, number>;
	/** Reasons to distrust a segment's slope, by transformer segment id ("w<way>:<index>"). */
	slopeIssues: Record<string, SlopeIssue[]>;
}

/**
 * Preprocessed DEM elevations for the campus path network, plus the list of path segments
 * whose DEM-derived slope is unreliable. Read-only after construction.
 */
export class ElevationDataset {
	readonly source: Readonly<Record<string, string | number>>;
	private readonly elevations: ReadonlyMap<number, number>;
	private readonly issues: ReadonlyMap<string, readonly SlopeIssue[]>;

	/** Throws MalformedDataError if the file is not a valid elevation file. */
	constructor(file: ElevationFile) {
		if (!file || file.format !== ELEVATION_FILE_FORMAT) {
			throw new MalformedDataError(`Elevation file must have format ${ELEVATION_FILE_FORMAT}`);
		}
		const elevations = new Map<number, number>();
		for (const [osmId, meters] of Object.entries(file.elevationsM ?? {})) {
			if (!/^\d+$/.test(osmId) || !Number.isFinite(meters)) {
				throw new MalformedDataError(`Invalid elevation entry: ${osmId} = ${String(meters)}`);
			}
			elevations.set(Number(osmId), meters);
		}
		const issues = new Map<string, readonly SlopeIssue[]>();
		for (const [segmentId, list] of Object.entries(file.slopeIssues ?? {})) {
			if (!Array.isArray(list) || !list.every((issue) => SLOPE_ISSUES.has(issue))) {
				throw new MalformedDataError(`Invalid slope issues for segment ${segmentId}`);
			}
			issues.set(segmentId, Object.freeze([...list]));
		}
		this.source = Object.freeze({ ...file.source });
		this.elevations = elevations;
		this.issues = issues;
		Object.freeze(this);
	}

	get nodeCount(): number {
		return this.elevations.size;
	}

	/** Elevation in meters for an OSM node, or undefined if it was not sampled. */
	elevationOf(osmNodeId: number): number | undefined {
		return this.elevations.get(osmNodeId);
	}

	/** Reasons this segment's DEM slope is unreliable; empty when none were found. */
	slopeIssuesOf(segmentId: string): readonly SlopeIssue[] {
		return this.issues.get(segmentId) ?? [];
	}

	isSlopeReliable(segmentId: string): boolean {
		return !this.issues.has(segmentId);
	}

	/**
	 * Transformer options that attach these elevations to graph nodes. Slopes are derived
	 * from elevation only when deriveSlopes is true, and then only for reliable segments.
	 * Keep deriveSlopes false until the team has validated the slopes (Easiest routing
	 * reacts to slopes as soon as they are present).
	 */
	transformOptions(deriveSlopes = false): OsmCampusTransformOptions {
		return {
			elevationLookup: (_lat, _lng, osmNodeId) => this.elevationOf(osmNodeId),
			deriveSlopeFromElevation: deriveSlopes,
			isSlopeReliable: (segmentId) => this.isSlopeReliable(segmentId)
		};
	}
}
