/** Base class for all Campus Data failures so callers can catch one type. */
export class CampusDataError extends Error {
	constructor(message: string) {
		super(message);
		this.name = new.target.name;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

/** The data source could not be read (network, file, parse failure, or repository not loaded). */
export class DataLoadError extends CampusDataError {}

/** Data was read but is invalid (missing fields, bad values, dangling references, duplicates). */
export class MalformedDataError extends CampusDataError {}

/** A requested building or node does not exist. */
export class NotFoundError extends CampusDataError {}
