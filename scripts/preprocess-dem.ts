/**
 * Preprocesses the USGS 1-meter DEM into the small elevation file the app loads.
 *
 *   bun scripts/preprocess-dem.ts --dem <path to USGS_one_meter_x35y352_TX_RioGrand_FTWhit_2014.tif>
 *
 * Optional: --osm <OSM export> (default static/data/campus-osm.json)
 *           --out <output file> (default static/data/campus-elevation.json)
 *           --vertical-rmse <meters> (default 0.10, the USGS QL2 lidar accuracy)
 *
 * It runs the OSM export through the same OsmCampusTransformer the app uses, samples the DEM
 * at every path-network node (bilinear interpolation), and flags path segments whose slope
 * cannot be trusted. The GeoTIFF itself is NOT committed: download it from
 * https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/TX_RioGrand_FTWhit_2014/TIFF/
 * See docs/elevation-dataset.md for the dataset and the meaning of each slope issue.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fromFile } from 'geotiff';
import proj4 from 'proj4';
import {
	ELEVATION_FILE_FORMAT,
	type ElevationFile,
	type SlopeIssue
} from '../src/lib/campusdata/ElevationDataset';
import { OsmCampusTransformer, type OsmData } from '../src/lib/campusdata/OsmCampusTransformer';

/** DEM coordinate system: NAD83 / UTM zone 13N. OSM coordinates are WGS84 (about 1 m apart). */
const UTM_13N = '+proj=utm +zone=13 +datum=NAD83 +units=m +no_defs +type=crs';

/** Segments shorter than this have a grade uncertainty above MAX_GRADE_UNCERTAINTY_PCT. */
const MAX_GRADE_UNCERTAINTY_PCT = 2;
/** Height range (m) in the 3x3 pixels around an endpoint that signals a wall or curb edge. */
const DISCONTINUITY_RELIEF_M = 1.0;
/** Largest gap (m) between the ground and a straight incline between the endpoints. */
const PROFILE_DEVIATION_M = 0.5;
/** Non-stair grades steeper than this need a field check before they are trusted. */
const STEEP_GRADE_PCT = 15;

const { values: args } = parseArgs({
	options: {
		dem: { type: 'string' },
		osm: { type: 'string', default: 'static/data/campus-osm.json' },
		out: { type: 'string', default: 'static/data/campus-elevation.json' },
		'vertical-rmse': { type: 'string', default: '0.10' }
	}
});
if (!args.dem) {
	console.error('Usage: bun scripts/preprocess-dem.ts --dem <USGS 1 m DEM GeoTIFF>');
	process.exit(1);
}
const verticalRmseM = Number(args['vertical-rmse']);

/** Bilinear sampler over a window of the DEM, in UTM meters. */
class DemWindow {
	constructor(
		private readonly values: Float32Array,
		private readonly width: number,
		private readonly height: number,
		private readonly left: number,
		private readonly top: number,
		private readonly nodata: number
	) {}

	private pixel(col: number, row: number): number | undefined {
		if (col < 0 || row < 0 || col >= this.width || row >= this.height) return undefined;
		const value = this.values[row * this.width + col];
		return value === this.nodata || !Number.isFinite(value) || value < -1000 ? undefined : value;
	}

	/** Elevation at a UTM point, interpolated between the four nearest pixel centers. */
	sample(x: number, y: number): number | undefined {
		const fx = x - this.left - 0.5;
		const fy = this.top - y - 0.5;
		const col = Math.floor(fx);
		const row = Math.floor(fy);
		const tx = fx - col;
		const ty = fy - row;
		const corners = [
			this.pixel(col, row),
			this.pixel(col + 1, row),
			this.pixel(col, row + 1),
			this.pixel(col + 1, row + 1)
		];
		if (corners.some((v) => v === undefined)) return undefined;
		const [z00, z10, z01, z11] = corners as number[];
		return (z00 * (1 - tx) + z10 * tx) * (1 - ty) + (z01 * (1 - tx) + z11 * tx) * ty;
	}

	/** Height range of the 3x3 pixels around a UTM point. */
	localRelief(x: number, y: number): number {
		const col = Math.floor(x - this.left);
		const row = Math.floor(this.top - y);
		const around: number[] = [];
		for (let dr = -1; dr <= 1; dr++) {
			for (let dc = -1; dc <= 1; dc++) {
				const v = this.pixel(col + dc, row + dr);
				if (v !== undefined) around.push(v);
			}
		}
		return around.length === 0 ? Infinity : Math.max(...around) - Math.min(...around);
	}
}

async function sha256(path: string): Promise<string> {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest('hex');
}

function isStructure(tags: Record<string, string>): boolean {
	const yes = (key: string) => tags[key] !== undefined && tags[key] !== 'no';
	return (
		yes('bridge') ||
		yes('tunnel') ||
		tags.covered === 'yes' ||
		tags.indoor === 'yes' ||
		tags.highway === 'corridor' ||
		(tags.layer !== undefined && tags.layer !== '0')
	);
}

const osm = JSON.parse(await readFile(args.osm, 'utf8')) as OsmData & {
	osm3s?: { timestamp_osm_base?: string };
};
const { data } = new OsmCampusTransformer().transform(osm);
const wayTags = new Map(
	osm.elements.filter((el) => el.type === 'way').map((way) => [way.id, way.tags ?? {}] as const)
);

const toUtm = proj4('EPSG:4326', UTM_13N);
const utm = new Map(data.nodes.map((n) => [n.id, toUtm.forward([n.lng, n.lat])] as const));

// Read only the DEM window that covers the path network (plus a margin).
const tiff = await fromFile(args.dem);
const image = await tiff.getImage();
const [originX, originY] = image.getOrigin();
const xs = [...utm.values()].map((p) => p[0]);
const ys = [...utm.values()].map((p) => p[1]);
const margin = 5;
const left = Math.max(0, Math.floor(Math.min(...xs) - originX) - margin);
const right = Math.min(image.getWidth(), Math.ceil(Math.max(...xs) - originX) + margin);
const top = Math.max(0, Math.floor(originY - Math.max(...ys)) - margin);
const bottom = Math.min(image.getHeight(), Math.ceil(originY - Math.min(...ys)) + margin);
const [band] = (await image.readRasters({ window: [left, top, right, bottom] })) as Float32Array[];
const dem = new DemWindow(
	band,
	right - left,
	bottom - top,
	originX + left,
	originY - top,
	Number(image.getGDALNoData())
);

const elevationsM: Record<string, number> = {};
for (const node of data.nodes) {
	const [x, y] = utm.get(node.id)!;
	const z = dem.sample(x, y);
	if (z !== undefined) elevationsM[node.id.slice(1)] = Math.round(z * 100) / 100;
}

const slopeIssues: Record<string, SlopeIssue[]> = {};
const minReliableLengthM = (Math.SQRT2 * verticalRmseM * 100) / MAX_GRADE_UNCERTAINTY_PCT;
const reliableGrades: { id: string; grade: number; lengthM: number }[] = [];
let stairSegments = 0;
for (const edge of data.edges) {
	const issues: SlopeIssue[] = [];
	const tags = wayTags.get(Number(edge.id.slice(1, edge.id.indexOf(':')))) ?? {};
	const za = elevationsM[edge.fromId.slice(1)];
	const zb = elevationsM[edge.toId.slice(1)];
	const [xa, ya] = utm.get(edge.fromId)!;
	const [xb, yb] = utm.get(edge.toId)!;
	if (edge.hasStairs) stairSegments++;

	if (za === undefined || zb === undefined) issues.push('missing-elevation');
	if (isStructure(tags)) issues.push('structure');
	if (edge.distanceM < minReliableLengthM) issues.push('short-segment');
	if (
		dem.localRelief(xa, ya) > DISCONTINUITY_RELIEF_M ||
		dem.localRelief(xb, yb) > DISCONTINUITY_RELIEF_M
	) {
		issues.push('terrain-discontinuity');
	}
	if (za !== undefined && zb !== undefined) {
		const steps = Math.max(2, Math.ceil(Math.hypot(xb - xa, yb - ya)));
		let deviation = 0;
		for (let k = 1; k < steps; k++) {
			const t = k / steps;
			const ground = dem.sample(xa + (xb - xa) * t, ya + (yb - ya) * t);
			if (ground !== undefined)
				deviation = Math.max(deviation, Math.abs(ground - (za + (zb - za) * t)));
		}
		if (deviation > PROFILE_DEVIATION_M) issues.push('irregular-profile');
		const grade = edge.distanceM > 0 ? ((zb - za) / edge.distanceM) * 100 : 0;
		if (!edge.hasStairs && Math.abs(grade) > STEEP_GRADE_PCT) issues.push('steep-needs-validation');
		if (issues.length === 0 && !edge.hasStairs) {
			reliableGrades.push({ id: edge.id, grade, lengthM: edge.distanceM });
		}
	}
	if (issues.length > 0) slopeIssues[edge.id] = issues;
}

const output: ElevationFile = {
	format: ELEVATION_FILE_FORMAT,
	source: {
		dataset: 'USGS 3DEP 1 m DEM, project TX_RioGrand_FTWhit_2014 (lidar Nov 30 - Dec 11, 2014)',
		tile: 'USGS_one_meter_x35y352_TX_RioGrand_FTWhit_2014.tif',
		tileSha256: await sha256(args.dem),
		crs: 'EPSG:26913 (NAD83 / UTM zone 13N); elevations in meters, NAVD88, bare earth',
		sampling: 'bilinear at OSM path-network nodes',
		assumedVerticalRmseM: verticalRmseM,
		osmExport: args.osm,
		osmTimestamp: osm.osm3s?.timestamp_osm_base ?? 'unknown'
	},
	elevationsM,
	slopeIssues
};
await writeFile(args.out, JSON.stringify(output) + '\n');

// Summary for the documentation.
const counts = new Map<string, number>();
for (const list of Object.values(slopeIssues)) {
	for (const issue of list) counts.set(issue, (counts.get(issue) ?? 0) + 1);
}
const zs = Object.values(elevationsM);
const abs = reliableGrades.map((g) => Math.abs(g.grade)).sort((a, b) => a - b);
const pct = (q: number) => abs[Math.min(abs.length - 1, Math.floor(q * abs.length))].toFixed(1);
console.log(`Wrote ${args.out}`);
console.log(`Nodes sampled: ${zs.length} / ${data.nodes.length}`);
console.log(`Elevation range: ${Math.min(...zs).toFixed(2)} to ${Math.max(...zs).toFixed(2)} m`);
console.log(
	`Segments: ${data.edges.length} (stairs ${stairSegments}); flagged ${Object.keys(slopeIssues).length}; reliable non-stair ${reliableGrades.length}`
);
console.log(`Minimum reliable segment length: ${minReliableLengthM.toFixed(1)} m`);
console.log('Issues:', Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])));
console.log(`Reliable |grade| percentiles: p50 ${pct(0.5)}%, p90 ${pct(0.9)}%, p99 ${pct(0.99)}%`);
console.log(
	`Reliable segments steeper than 8.33% (ADA ramp limit): ${abs.filter((g) => g > 8.33).length}`
);
