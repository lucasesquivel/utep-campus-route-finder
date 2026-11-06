import type { RawCampusData } from './types';

/**
 * Where raw campus data comes from (static file, OSM export, test stub).
 * Implementations only fetch and parse; validation happens in CampusRepository.
 * Should throw DataLoadError if the data cannot be read.
 */
export interface CampusDataSource {
	load(): Promise<RawCampusData>;
}