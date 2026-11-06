import type { CampusDataSource } from './CampusDataSource';
import { fetchJson } from './fetchJson';
import { OsmCampusTransformer, type OsmCampusTransformOptions, type OsmData } from './OsmCampusTransformer';
import type { RawCampusData } from './types';

/** Loads an OSM (Overpass JSON) export and transforms it into the internal campus model. */
export class OsmCampusDataSource implements CampusDataSource {
	/** Non-fatal transformer warnings from the most recent load(). */
	warnings: string[] = [];

	private readonly url: string;
	private readonly options: OsmCampusTransformOptions;
	private readonly fetchFn?: typeof fetch;

	constructor(url: string = '/data/campus-osm.json', options: OsmCampusTransformOptions = {}, fetchFn?: typeof fetch) {
		this.url = url;
		this.options = options;
		this.fetchFn = fetchFn;
	}

	async load(): Promise<RawCampusData> {
		const osm = await fetchJson<OsmData>(this.url, this.fetchFn);
		const result = new OsmCampusTransformer(this.options).transform(osm);
		this.warnings = result.warnings;
		return result.data;
	}
}