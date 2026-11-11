import { DataLoadError } from './errors';

/** Fetches and parses JSON, converting every failure into a DataLoadError. */
export async function fetchJson<T>(url: string, fetchFn?: typeof fetch): Promise<T> {
	const doFetch = fetchFn ?? fetch;
	let response: Response;
	try {
		response = await doFetch(url);
	} catch (err) {
		throw new DataLoadError(`Could not fetch campus data from ${url}: ${String(err)}`);
	}
	if (!response.ok) {
		throw new DataLoadError(`Campus data request failed (${response.status}) for ${url}`);
	}
	try {
		return (await response.json()) as T;
	} catch (err) {
		throw new DataLoadError(`Campus data at ${url} is not valid JSON: ${String(err)}`);
	}
}
