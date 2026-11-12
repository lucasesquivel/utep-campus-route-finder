import type {
	RouteSelection,
	RouteResponse,
	ValidationResult,
	SerializedRoute,
	ValidationCode,
	LngLat,
	NoRouteReason
} from './types';

// Import interfaces/classes using SvelteKit $lib aliases
import { CampusRepository } from '../campusdata/CampusRepository';
import type { GraphNode } from '../campusdata/types';
import type { CampusGraph } from '../campusdata/CampusGraph';
import { RouteEngine } from '../routing/RouteEngine';
import { ShortestRouteStrategy } from '../routing/ShortestRouteStrategy';
import { EasyRouteStrategy } from '../routing/EasyRouteStrategy';
import { AdaRouteStrategy } from '../routing/AdaRouteStrategy';
import type { RouteRequest, RouteResult } from '../routing/types';

const SUPPORTED_MODES: readonly string[] = ['shortest', 'easy', 'ada'];

export class RouteController {
	private repository: CampusRepository;
	private loaded = false;
	private loading?: Promise<void>;
	private readonly MAX_MAP_SNAP_DISTANCE_M = 50;

	constructor(repository: CampusRepository) {
		this.repository = repository;
	}

	/**
	 * Contract AC-1: Process Route Request
	 * Takes user selections, validates them, builds endpoints, and obtains a Route or failure.
	 */
	public async processRouteRequest(selection: RouteSelection): Promise<RouteResponse> {
		try {
			// 1. Make sure campus data is loaded (only downloads the first time).
			try {
				await this.ensureLoaded();
			} catch {
				return this.handleRouteFailure({
					name: 'CampusDataLoadError',
					message: 'Failed to load campus data'
				});
			}

			// 2. Build the engine from the CURRENT repository data on every request, so it can
			// never use an older graph than the repository holds. (Cheap: it is just an adapter.)
			const routeEngine = new RouteEngine(this.repository.getRoutingGraph(), [
				new ShortestRouteStrategy(),
				new EasyRouteStrategy(),
				new AdaRouteStrategy()
			]);

			// 3. Validate selections (Contract AC-2)
			const validation = this.validateRouteRequest(selection);
			if (!validation.valid) {
				return this.handleRouteFailure({
					name: 'ValidationFailure',
					code: validation.code,
					message: validation.message
				});
			}

			// 4. Build Routing Endpoints using actual merged methods
			const internalGraph = this.repository.getGraph();

			const buildEndpoints = (locationSelection: typeof selection.origin) => {
				if (locationSelection.kind === 'building') {
					const entrances = this.repository.getRoutingEntrances(locationSelection.buildingId);
					return entrances.map((e) => ({ nodeId: e.nodeId, entrance: e }));
				} else {
					const nearestNode = this.findNearestNode(
						internalGraph,
						locationSelection.location,
						this.MAX_MAP_SNAP_DISTANCE_M
					);
					if (!nearestNode) throw new Error('Map point is not near a path');
					return [{ nodeId: nearestNode.id }];
				}
			};

			const origins = buildEndpoints(selection.origin);
			const destinations = buildEndpoints(selection.destination);

			const routeRequest: RouteRequest = {
				mode: selection.mode,
				origins,
				destinations
			};

			// 5. Retrieve Route Result (Contract AC-3)
			return this.retrieveRouteResult(routeRequest, routeEngine);
		} catch (error) {
			console.error('Unexpected error in processRouteRequest:', error);
			return this.handleRouteFailure(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Contract AC-2: Validate Route Request
	 */
	public validateRouteRequest(selection: RouteSelection): ValidationResult {
		if (!selection.origin) {
			return { valid: false, code: 'MISSING_ORIGIN', message: 'Starting location is required.' };
		}
		if (!selection.destination) {
			return {
				valid: false,
				code: 'MISSING_DESTINATION',
				message: 'Destination location is required.'
			};
		}

		if (!SUPPORTED_MODES.includes(selection.mode)) {
			return {
				valid: false,
				code: 'UNSUPPORTED_MODE',
				message: `Routing mode '${selection.mode}' is not supported.`
			};
		}

		let internalGraph: CampusGraph;
		try {
			internalGraph = this.repository.getGraph();
		} catch {
			return {
				valid: false,
				code: 'DATA_NOT_LOADED',
				message: 'Campus data has not been loaded yet.'
			};
		}

		// Validate origin
		if (selection.origin.kind === 'building') {
			const building = this.repository.getBuilding(selection.origin.buildingId);
			if (!building) {
				return {
					valid: false,
					code: 'UNKNOWN_BUILDING',
					message: 'Starting building does not exist.'
				};
			}
			const entrances = this.repository.getEntrances(selection.origin.buildingId);
			if (entrances.length === 0) {
				return {
					valid: false,
					code: 'NO_ENTRANCES',
					message: 'Starting building has no registered entrances.'
				};
			}
		} else {
			const nearest = this.findNearestNode(
				internalGraph,
				selection.origin.location,
				this.MAX_MAP_SNAP_DISTANCE_M
			);
			if (!nearest) {
				return {
					valid: false,
					code: 'LOCATION_OFF_NETWORK',
					message: 'Starting location is too far from a pedestrian path.'
				};
			}
		}

		// Validate destination
		if (selection.destination.kind === 'building') {
			const building = this.repository.getBuilding(selection.destination.buildingId);
			if (!building) {
				return {
					valid: false,
					code: 'UNKNOWN_BUILDING',
					message: 'Destination building does not exist.'
				};
			}
			const entrances = this.repository.getEntrances(selection.destination.buildingId);
			if (entrances.length === 0) {
				return {
					valid: false,
					code: 'NO_ENTRANCES',
					message: 'Destination building has no registered entrances.'
				};
			}
		} else {
			const nearest = this.findNearestNode(
				internalGraph,
				selection.destination.location,
				this.MAX_MAP_SNAP_DISTANCE_M
			);
			if (!nearest) {
				return {
					valid: false,
					code: 'LOCATION_OFF_NETWORK',
					message: 'Destination location is too far from a pedestrian path.'
				};
			}
		}

		return { valid: true };
	}

	/**
	 * Contract AC-3: Retrieve Route Result
	 */
	public retrieveRouteResult(request: RouteRequest, routeEngine?: RouteEngine): RouteResponse {
		const engine = routeEngine ?? this.buildEngine();
		if (!engine) {
			return this.handleRouteFailure({ name: 'StateError', message: 'Campus data not loaded' });
		}

		const result: RouteResult = engine.calculateRoute(request);

		if (result.status === 'found') {
			const route = result.route;

			// Explicitly serialize the Route class instance into a plain JSON object
			// preserving coordinates and metrics required by the UI subsystem.
			const serializedRoute: SerializedRoute = {
				mode: route.mode,
				origin: route.origin,
				destination: route.destination,
				nodeIds: route.nodeIds,
				traversals: route.traversals,
				coordinates: route.coordinates, // Route class exposes readonly LngLat[] coordinates directly
				totalDistanceM: route.totalDistanceM,
				totalCost: route.totalCost,
				elevationGainM: route.elevationGainM,
				elevationLossM: route.elevationLossM,
				elevationComplete: route.elevationComplete,
				stairSegmentCount: route.stairSegmentCount,
				unverifiedAccessibilityDistanceM: route.unverifiedAccessibilityDistanceM,
				estimatedWalkTimeS: route.estimatedWalkTimeS
			};

			return {
				status: 'success',
				route: serializedRoute
			};
		} else {
			return this.handleRouteFailure(result);
		}
	}

	/**
	 * Contract AC-4: Handle Route Failure
	 */
	public handleRouteFailure(cause: unknown): RouteResponse {
		const c = (cause ?? {}) as Record<string, unknown>;
		if (c.status === 'no-route') {
			const reason = c.reason as NoRouteReason;
			let message = 'No route could be calculated.';
			if (reason === 'NO_USABLE_ORIGIN') {
				message = 'The starting building has no entrance usable in this mode.';
			} else if (reason === 'NO_USABLE_DESTINATION') {
				message = 'The destination building has no entrance usable in this mode.';
			} else if (reason === 'UNREACHABLE') {
				message = 'No route exists between these locations for the selected mode.';
			}
			return {
				status: 'failure',
				failure: {
					code: 'NO_ROUTE',
					message,
					noRouteReason: reason
				}
			};
		}

		if (c.name === 'ValidationFailure') {
			return {
				status: 'failure',
				failure: {
					code: 'INVALID_REQUEST',
					message: String(c.message),
					validationCode: c.code as ValidationCode
				}
			};
		}

		if (c.name === 'CampusDataLoadError') {
			return {
				status: 'failure',
				failure: {
					code: 'DATA_NOT_READY',
					message: 'Campus data could not be loaded. Please try again.'
				}
			};
		}

		return {
			status: 'failure',
			failure: {
				code: 'UNEXPECTED_ERROR',
				message: 'Something went wrong. Please try again.'
			}
		};
	}

	public ensureLoaded(): Promise<void> {
		if (this.loaded) return Promise.resolve();
		this.loading ??= this.repository
			.loadCampusData()
			.then(() => {
				this.loaded = true;
			})
			.finally(() => {
				this.loading = undefined;
			});
		return this.loading;
	}

	private buildEngine(): RouteEngine | undefined {
		try {
			return new RouteEngine(this.repository.getRoutingGraph(), [
				new ShortestRouteStrategy(),
				new EasyRouteStrategy(),
				new AdaRouteStrategy()
			]);
		} catch {
			return undefined;
		}
	}

	private findNearestNode(
		graph: CampusGraph,
		target: LngLat,
		maxDistM: number
	): GraphNode | undefined {
		let closestNode: GraphNode | undefined;
		let minDist = Infinity;
		for (const node of graph.getNodes()) {
			const dist = this.haversineDistance(target, [node.lng, node.lat]);
			if (dist < minDist && dist <= maxDistM) {
				minDist = dist;
				closestNode = node;
			}
		}
		return closestNode;
	}

	private haversineDistance(coords1: [number, number], coords2: [number, number]): number {
		const toRad = (x: number) => (x * Math.PI) / 180;
		const [lon1, lat1] = coords1;
		const [lon2, lat2] = coords2;
		const R = 6371000;
		const dLat = toRad(lat2 - lat1);
		const dLon = toRad(lon2 - lon1);
		const a =
			Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return R * c;
	}
}
