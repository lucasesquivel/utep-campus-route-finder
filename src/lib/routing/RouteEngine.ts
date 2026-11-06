import { haversineDistanceM } from '../shared/haversine';
import type { LngLat, RouteMode } from '../shared/types';
import type { CampusGraphView, NodeId, PathTraversalView } from './campusDataView';
import { RouteRequestError } from './errors';
import { MinPriorityQueue } from './MinPriorityQueue';
import { Route } from './Route';
import type { RoutingStrategy } from './RoutingStrategy';
import type { NoRouteReason, RouteEndpoint, RouteRequest, RouteResult } from './types';

/** Entry in the A* open queue. */
interface QueueEntry {
	readonly nodeId: NodeId;
	/** f = g + h */
	readonly f: number;
	readonly h: number;
}

/** Fixed tie-breaking (RT-1 step 7): lowest f, then lowest h, then smaller node id. */
function compareEntries(a: QueueEntry, b: QueueEntry): number {
	if (a.f !== b.f) return a.f - b.f;
	if (a.h !== b.h) return a.h - b.h;
	return a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0;
}

/**
 * Runs the route search (SDD 5.2). Holds the CampusGraph and the registered routing
 * strategies, and answers route requests for any mode with one A* search.
 *
 * Created once after Campus Data finishes loading:
 * `new RouteEngine(repository.getCampusGraph(), strategies)`. It keeps no state between
 * calls, so concurrent requests on the immutable graph are safe. The search does not know
 * about routing modes: adding a mode means registering another RoutingStrategy.
 */
export class RouteEngine {
	private readonly graph: CampusGraphView;
	private readonly strategies: ReadonlyMap<RouteMode, RoutingStrategy>;
	private readonly modes: readonly RouteMode[];

	/**
	 * @param graph the immutable CampusGraph (CD-2); Routing reads it through CG-2 and CG-3.
	 * @param strategies one strategy per supported mode. Throws Error if two strategies
	 *   register the same mode.
	 */
	constructor(graph: CampusGraphView, strategies: readonly RoutingStrategy[]) {
		const byMode = new Map<RouteMode, RoutingStrategy>();
		for (const strategy of strategies) {
			if (byMode.has(strategy.mode)) {
				throw new Error(`More than one RoutingStrategy registered for mode '${strategy.mode}'`);
			}
			byMode.set(strategy.mode, strategy);
		}
		this.graph = graph;
		this.strategies = byMode;
		this.modes = Object.freeze([...byMode.keys()]);
	}

	/** Modes that have a registered strategy, in registration order. */
	supportedModes(): readonly RouteMode[] {
		return this.modes;
	}

	/**
	 * RT-1 Calculate Route: lowest-cost route from any usable origin endpoint to any usable
	 * destination endpoint under request.mode, or a no-route result with a reason.
	 *
	 * Throws RouteRequestError (EMPTY_ORIGINS, EMPTY_DESTINATIONS, UNSUPPORTED_MODE,
	 * UNKNOWN_NODE, ENDPOINT_MISMATCH) when a precondition is violated. Throws Error if a
	 * strategy breaks the RS-2 contract. No route is a normal result, not an exception.
	 */
	calculateRoute(request: RouteRequest): RouteResult {
		// 1-2. Preconditions, then the strategy for the requested mode.
		const strategy = this.validateRequest(request);

		// 3. Drop endpoints the strategy does not allow; keep duplicate node ids once.
		const origins = RouteEngine.filterUsableEndpoints(request.origins, strategy);
		if (origins.size === 0) return this.buildNoRouteResult(request.mode, 'NO_USABLE_ORIGIN');
		const destinations = RouteEngine.filterUsableEndpoints(request.destinations, strategy);
		if (destinations.size === 0)
			return this.buildNoRouteResult(request.mode, 'NO_USABLE_DESTINATION');

		// 4. An origin that is already a goal gives a zero-length route.
		for (const [nodeId, origin] of origins) {
			const destination = destinations.get(nodeId);
			if (destination) {
				return this.buildFoundResult(request.mode, origin, destination, [], 0);
			}
		}

		return this.search(request.mode, strategy, origins, destinations);
	}

	/** Steps 5 to 9 of RT-1: A* from all origins to the nearest goal. */
	private search(
		mode: RouteMode,
		strategy: RoutingStrategy,
		origins: ReadonlyMap<NodeId, RouteEndpoint>,
		destinations: ReadonlyMap<NodeId, RouteEndpoint>
	): RouteResult {
		// Search state is local to this call. A* terms: g is the cost from an origin to a
		// node (costFromOrigin), h the heuristic estimate to the nearest goal, f = g + h.
		const costFromOrigin = new Map<NodeId, number>();
		const previous = new Map<NodeId, PathTraversalView>();
		const closed = new Set<NodeId>();
		const open = new MinPriorityQueue<QueueEntry>(compareEntries);
		const heuristic = this.createHeuristic(destinations);

		// 6. Seed every origin with g = 0.
		for (const nodeId of origins.keys()) {
			costFromOrigin.set(nodeId, 0);
			const h = heuristic(nodeId);
			open.push({ nodeId, f: h, h });
		}

		// 7-8. Expand nodes in f order until a goal is popped or the queue empties.
		for (let entry = open.pop(); entry !== undefined; entry = open.pop()) {
			const current = entry.nodeId;
			if (closed.has(current)) continue;
			const costToCurrent = RouteEngine.requireEntry(costFromOrigin, current);
			if (destinations.has(current)) {
				return this.rebuild(mode, current, costToCurrent, previous, origins, destinations);
			}
			closed.add(current);

			for (const traversal of this.graph.getNeighbors(current)) {
				const next = traversal.toNodeId;
				if (closed.has(next) || !strategy.isTraversable(traversal)) continue;

				const edgeCost = strategy.edgeCost(traversal);
				if (!Number.isFinite(edgeCost) || edgeCost < traversal.distanceM) {
					throw new Error(
						`RoutingStrategy '${strategy.mode}' violated RS-2 on edge ${traversal.edge.id}: ` +
							`cost ${edgeCost} must be finite and >= distanceM ${traversal.distanceM}`
					);
				}

				const candidateCost = costToCurrent + edgeCost;
				const knownCost = costFromOrigin.get(next);
				if (knownCost === undefined || candidateCost < knownCost) {
					costFromOrigin.set(next, candidateCost);
					previous.set(next, traversal);
					const h = heuristic(next);
					open.push({ nodeId: next, f: candidateCost + h, h });
				}
			}
		}

		return this.buildNoRouteResult(mode, 'UNREACHABLE');
	}

	/**
	 * 9. Follow back-pointers from the goal to an origin, then build the Route (RO-1).
	 */
	private rebuild(
		mode: RouteMode,
		goal: NodeId,
		totalCost: number,
		previous: ReadonlyMap<NodeId, PathTraversalView>,
		origins: ReadonlyMap<NodeId, RouteEndpoint>,
		destinations: ReadonlyMap<NodeId, RouteEndpoint>
	): RouteResult {
		const path: PathTraversalView[] = [];
		let node = goal;
		for (
			let traversal = previous.get(node);
			traversal !== undefined;
			traversal = previous.get(node)
		) {
			path.push(traversal);
			node = traversal.fromNodeId;
		}
		path.reverse();

		const origin = RouteEngine.requireEntry(origins, node);
		const destination = RouteEngine.requireEntry(destinations, goal);
		return this.buildFoundResult(mode, origin, destination, path, totalCost);
	}

	private buildFoundResult(
		mode: RouteMode,
		origin: RouteEndpoint,
		destination: RouteEndpoint,
		traversals: readonly PathTraversalView[],
		totalCost: number
	): RouteResult {
		const originLocation = this.getNodeLocation(origin.nodeId);
		const route = Route.build({ mode, origin, destination, originLocation, traversals, totalCost });
		return Object.freeze({ status: 'found', route });
	}

	private buildNoRouteResult(mode: RouteMode, reason: NoRouteReason): RouteResult {
		return Object.freeze({ status: 'no-route', mode, reason });
	}

	/**
	 * h(n) = smallest haversine distance from n to any goal node (RT-1 step 5). Admissible
	 * and consistent because every strategy cost is >= distanceM, which is measured along
	 * the path geometry and so is never shorter than the straight line. Memoized per call.
	 */
	private createHeuristic(
		destinations: ReadonlyMap<NodeId, RouteEndpoint>
	): (nodeId: NodeId) => number {
		const goalLocations: LngLat[] = [...destinations.keys()].map((id) => this.getNodeLocation(id));
		const cache = new Map<NodeId, number>();
		return (nodeId) => {
			const cached = cache.get(nodeId);
			if (cached !== undefined) return cached;
			const here = this.getNodeLocation(nodeId);
			let nearest = Infinity;
			for (const goal of goalLocations) {
				const distance = haversineDistanceM(here, goal);
				if (distance < nearest) nearest = distance;
			}
			cache.set(nodeId, nearest);
			return nearest;
		};
	}

	/**
	 * Value stored for key in a search-state map. Every lookup is guarded by the algorithm,
	 * so a miss means an internal invariant broke; fail loudly instead of asserting a type.
	 */
	private static requireEntry<K, V>(map: ReadonlyMap<K, V>, key: K): V {
		const value = map.get(key);
		if (value === undefined) {
			throw new Error(`Route search state is missing an entry for ${String(key)}`);
		}
		return value;
	}

	private getNodeLocation(nodeId: NodeId): LngLat {
		const node = this.graph.getNode(nodeId);
		if (!node) {
			// Only reachable if CG-3 returns a neighbor that CG-2 does not know.
			throw new Error(`CampusGraph returned unknown node ${nodeId}`);
		}
		return node.location;
	}

	/**
	 * RT-1 steps 1-2: throw RouteRequestError on the first violated precondition, otherwise
	 * return the strategy registered for the requested mode.
	 */
	private validateRequest(request: RouteRequest): RoutingStrategy {
		const strategy = this.strategies.get(request.mode);
		if (request.origins.length === 0) {
			throw new RouteRequestError('EMPTY_ORIGINS', 'RouteRequest has no origin endpoints');
		}
		if (request.destinations.length === 0) {
			throw new RouteRequestError(
				'EMPTY_DESTINATIONS',
				'RouteRequest has no destination endpoints'
			);
		}
		if (strategy === undefined) {
			throw new RouteRequestError(
				'UNSUPPORTED_MODE',
				`Routing mode '${request.mode}' is not supported; supported: ${this.modes.join(', ')}`
			);
		}
		for (const endpoint of [...request.origins, ...request.destinations]) {
			if (this.graph.getNode(endpoint.nodeId) === undefined) {
				throw new RouteRequestError(
					'UNKNOWN_NODE',
					`Endpoint node ${endpoint.nodeId} does not exist in the campus graph`
				);
			}
			if (endpoint.entrance && endpoint.entrance.nodeId !== endpoint.nodeId) {
				throw new RouteRequestError(
					'ENDPOINT_MISMATCH',
					`Entrance ${endpoint.entrance.id} is at node ${endpoint.entrance.nodeId}, ` +
						`but the endpoint names node ${endpoint.nodeId}`
				);
			}
		}
		return strategy;
	}

	/**
	 * Endpoints whose entrance is absent or usable under the strategy, keyed by node id.
	 * The first endpoint for a node id wins, which keeps the choice deterministic.
	 */
	private static filterUsableEndpoints(
		endpoints: readonly RouteEndpoint[],
		strategy: RoutingStrategy
	): Map<NodeId, RouteEndpoint> {
		const usable = new Map<NodeId, RouteEndpoint>();
		for (const endpoint of endpoints) {
			if (usable.has(endpoint.nodeId)) continue;
			if (endpoint.entrance && !strategy.isEntranceUsable(endpoint.entrance)) continue;
			usable.set(endpoint.nodeId, endpoint);
		}
		return usable;
	}
}
