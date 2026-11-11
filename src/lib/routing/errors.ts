/** Precondition that a RouteRequest violated (RT-1 postconditions). */
export type RouteRequestErrorCode =
	| 'EMPTY_ORIGINS'
	| 'EMPTY_DESTINATIONS'
	| 'UNSUPPORTED_MODE'
	| 'UNKNOWN_NODE'
	| 'ENDPOINT_MISMATCH';

/**
 * Thrown by RouteEngine.calculateRoute when a RouteRequest breaks an RT-1 precondition.
 * "No route" is a normal result and never raises this error.
 */
export class RouteRequestError extends Error {
	readonly code: RouteRequestErrorCode;

	constructor(code: RouteRequestErrorCode, message: string) {
		super(message);
		this.name = 'RouteRequestError';
		this.code = code;
	}
}
