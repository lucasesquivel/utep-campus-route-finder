import type { RouteController } from '../controller/RouteController';
import type { RouteMode } from '../controller/types';

export interface ApiReply {
	status: number;
	body: unknown;
}

const MODES: readonly string[] = ['shortest', 'easy', 'ada'];

/**
 * Turns the page's request ({ startBuildingId, destinationBuildingId, mode }) into a
 * Controller call, and the Controller's answer into what the page expects:
 *   200 { coordinates, distanceMeters, estimatedMinutes }
 *   422 { status: 'no_route' }   400 bad request   503 data not ready   500 anything else
 */
export async function handleRouteApi(
	body: unknown,
	controller: RouteController
): Promise<ApiReply> {
	const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
	const { startBuildingId, destinationBuildingId, mode } = input;
	if (
		typeof startBuildingId !== 'string' ||
		typeof destinationBuildingId !== 'string' ||
		typeof mode !== 'string' ||
		!MODES.includes(mode)
	) {
		return {
			status: 400,
			body: { error: 'Expected startBuildingId, destinationBuildingId and a valid mode.' }
		};
	}

	const response = await controller.processRouteRequest({
		origin: { kind: 'building', buildingId: startBuildingId },
		destination: { kind: 'building', buildingId: destinationBuildingId },
		mode: mode as RouteMode
	});

	if (response.status === 'success') {
		const { coordinates, totalDistanceM, estimatedWalkTimeS } = response.route;
		return {
			status: 200,
			body: {
				coordinates,
				distanceMeters: totalDistanceM,
				estimatedMinutes: estimatedWalkTimeS / 60
			}
		};
	}

	const { failure } = response;
	if (failure.code === 'NO_ROUTE')
		return { status: 422, body: { status: 'no_route', error: failure.message } };
	if (failure.code === 'INVALID_REQUEST') return { status: 400, body: { error: failure.message } };
	if (failure.code === 'DATA_NOT_READY') return { status: 503, body: { error: failure.message } };
	return { status: 500, body: { error: failure.message } };
}
