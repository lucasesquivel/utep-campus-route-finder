import type { CampusDataSource } from './CampusDataSource';
import { fetchJson } from './fetchJson';
import type { RawCampusData } from './types';

/**
 * Loads campus data already in the internal RawCampusData shape from a static JSON file
 * (default: /data/campus.json). Used for dummy/test data; real data uses OsmCampusDataSource.
 */
export class StaticFileCampusDataSource implements CampusDataSource {
	private readonly url: string;
	private readonly fetchFn?: typeof fetch;

	/** Pass SvelteKit's event.fetch as fetchFn when loading on the server. */
	constructor(url: string = '/data/campus.json', fetchFn?: typeof fetch) {
		this.url = url;
		this.fetchFn = fetchFn;
	}

	load(): Promise<RawCampusData> {
		return fetchJson<RawCampusData>(this.url, this.fetchFn);
	}
}