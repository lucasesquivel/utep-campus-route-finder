import { applyCorrections, type CampusCorrections } from './CampusCorrections';
import type { CampusDataSource } from './CampusDataSource';
import { fetchJson } from './fetchJson';
import {
	OsmCampusTransformer,
	type OsmCampusTransformOptions,
	type OsmData
} from './OsmCampusTransformer';
import { describeDisconnectedComponents } from './topology';
import type { RawCampusData } from './types';

/**
 * Loads a raw Overpass JSON export, transforms it into the internal campus model, applies the
 * team's manually verified corrections (kept in a separate file), and reports data gaps such
 * as disconnected parts of the path network as warnings.
 */
export class OsmCampusDataSource implements CampusDataSource {
	/** Non-fatal transformer and topology warnings from the most recent load(). */
	warnings: string[] = [];

	private readonly url: string;
	private readonly options: OsmCampusTransformOptions;
	private readonly fetchFn?: typeof fetch;
	private readonly correctionsUrl?: string;

	/** Pass SvelteKit's event.fetch as fetchFn when loading on the server. */
	constructor(
		url: string = '/data/campus-osm.json',
		options: OsmCampusTransformOptions = {},
		fetchFn?: typeof fetch,
		correctionsUrl?: string
	) {
		this.url = url;
		this.options = options;
		this.fetchFn = fetchFn;
		this.correctionsUrl = correctionsUrl;
	}

	async load(): Promise<RawCampusData> {
		const osm = await fetchJson<OsmData>(this.url, this.fetchFn);
		const result = new OsmCampusTransformer(this.options).transform(osm);
		const data = this.correctionsUrl
			? applyCorrections(
					result.data,
					await fetchJson<CampusCorrections>(this.correctionsUrl, this.fetchFn)
				)
			: result.data;
		this.warnings = [...result.warnings, ...describeDisconnectedComponents(data)];
		return data;
	}
}
