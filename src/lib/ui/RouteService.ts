import { NoRouteError, type RouteRequest, type RouteResult } from './types';

/** Only the Controller API is contacted here; no routing algorithm belongs in the UI. */
export interface RouteGateway {
	getRoute(request: RouteRequest, signal?: AbortSignal): Promise<RouteResult>;
}

export class HttpRouteService implements RouteGateway {
	constructor(private readonly endpoint = '/api/route') {}

	async getRoute(request: RouteRequest, signal?: AbortSignal): Promise<RouteResult> {
		const response = await fetch(this.endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(request),
			signal
		});
		if (response.status === 404 || response.status === 422) {
			// A 404 may instead indicate an unimplemented endpoint; the API team should
			// return a documented error code to distinguish that from a no-route result.
			if (response.status === 422) throw new NoRouteError();
		}
		if (!response.ok)
			throw new Error(
				`Route request failed (HTTP ${response.status}). Check the Controller API connection.`
			);
		const raw: unknown = await response.json();
		return parseRouteResult(raw);
	}
}

/** Validates the interface boundary rather than passing untrusted JSON into MapLibre. */
export function parseRouteResult(value: unknown): RouteResult {
	if (typeof value !== 'object' || value === null)
		throw new Error('Invalid route response: expected an object.');
	const data = value as Record<string, unknown>;
	if (data.status === 'no_route') throw new NoRouteError();
	const coordinates = data.coordinates;
	if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(isCoordinate)) {
		throw new Error(
			'Invalid route response: expected at least two [longitude, latitude] coordinates.'
		);
	}
	const distanceMeters = optionalNonNegativeNumber(data.distanceMeters, 'distanceMeters');
	const estimatedMinutes = optionalNonNegativeNumber(data.estimatedMinutes, 'estimatedMinutes');
	const instructions =
		data.instructions === undefined
			? undefined
			: Array.isArray(data.instructions) &&
				  data.instructions.every((item) => typeof item === 'string')
				? (data.instructions as string[])
				: undefined;
	return {
		coordinates: coordinates as [number, number][],
		distanceMeters,
		estimatedMinutes,
		instructions
	};
}

function isCoordinate(value: unknown): value is [number, number] {
	return (
		Array.isArray(value) &&
		value.length === 2 &&
		typeof value[0] === 'number' &&
		Number.isFinite(value[0]) &&
		Math.abs(value[0]) <= 180 &&
		typeof value[1] === 'number' &&
		Number.isFinite(value[1]) &&
		Math.abs(value[1]) <= 90
	);
}

function optionalNonNegativeNumber(value: unknown, key: string): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new Error(`Invalid route response: ${key} must be nonnegative.`);
	}
	return value;
}
