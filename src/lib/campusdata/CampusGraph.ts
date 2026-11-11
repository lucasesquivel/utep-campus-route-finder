import { MalformedDataError, NotFoundError } from './errors';
import type { AccessibilityStatus, GraphNode, PathEdge } from './types';

const ACCESSIBILITY_STATUSES: ReadonlySet<string> = new Set<AccessibilityStatus>([
	'accessible',
	'inaccessible',
	'unknown'
]);

/**
 * Directed graph of walkable nodes and path edges, with adjacency lookup.
 *
 * Immutable after construction (SDD): every node and edge is validated and frozen in the
 * constructor, the graph has no mutators, and lookups return frozen records and arrays.
 */
export class CampusGraph {
	private readonly nodes = new Map<string, GraphNode>();
	private readonly adjacency = new Map<string, readonly PathEdge[]>();
	readonly nodeCount: number;
	readonly edgeCount: number;

	/** Throws MalformedDataError for invalid, duplicate, or dangling records. */
	constructor(nodes: readonly GraphNode[], edges: readonly PathEdge[]) {
		const outgoing = new Map<string, PathEdge[]>();
		for (const node of nodes) {
			CampusGraph.validateNode(node, this.nodes);
			this.nodes.set(node.id, Object.freeze({ ...node }));
			outgoing.set(node.id, []);
		}

		const edgeIds = new Set<string>();
		for (const edge of edges) {
			this.validateEdge(edge, edgeIds);
			edgeIds.add(edge.id);
			outgoing.get(edge.fromId)!.push(Object.freeze({ ...edge }));
		}

		for (const [nodeId, list] of outgoing) this.adjacency.set(nodeId, Object.freeze(list));
		this.nodeCount = this.nodes.size;
		this.edgeCount = edgeIds.size;
		Object.freeze(this);
	}

	hasNode(id: string): boolean {
		return this.nodes.has(id);
	}

	getNode(id: string): GraphNode | undefined {
		return this.nodes.get(id);
	}

	/** Outgoing edges from a node. Throws NotFoundError if the node does not exist. */
	getNeighbors(nodeId: string): readonly PathEdge[] {
		const edges = this.adjacency.get(nodeId);
		if (!edges) throw new NotFoundError(`Unknown node: ${nodeId}`);
		return edges;
	}

	getNodes(): readonly GraphNode[] {
		return Object.freeze([...this.nodes.values()]);
	}

	private static validateNode(node: GraphNode, existing: ReadonlyMap<string, GraphNode>): void {
		if (!node.id) throw new MalformedDataError('Node is missing an id');
		if (existing.has(node.id)) throw new MalformedDataError(`Duplicate node id: ${node.id}`);
		if (!Number.isFinite(node.lat) || node.lat < -90 || node.lat > 90) {
			throw new MalformedDataError(`Node ${node.id} has invalid latitude: ${node.lat}`);
		}
		if (!Number.isFinite(node.lng) || node.lng < -180 || node.lng > 180) {
			throw new MalformedDataError(`Node ${node.id} has invalid longitude: ${node.lng}`);
		}
		if (node.elevationM !== undefined && !Number.isFinite(node.elevationM)) {
			throw new MalformedDataError(`Node ${node.id} has invalid elevation: ${node.elevationM}`);
		}
	}

	private validateEdge(edge: PathEdge, edgeIds: ReadonlySet<string>): void {
		if (!edge.id) throw new MalformedDataError('Edge is missing an id');
		if (edgeIds.has(edge.id)) throw new MalformedDataError(`Duplicate edge id: ${edge.id}`);
		for (const nodeId of [edge.fromId, edge.toId]) {
			if (!this.nodes.has(nodeId)) {
				throw new MalformedDataError(`Edge ${edge.id} references unknown node: ${nodeId}`);
			}
		}
		if (!Number.isFinite(edge.distanceM) || edge.distanceM < 0) {
			throw new MalformedDataError(`Edge ${edge.id} has invalid distance: ${edge.distanceM}`);
		}
		if (edge.slopePct !== undefined && !Number.isFinite(edge.slopePct)) {
			throw new MalformedDataError(`Edge ${edge.id} has invalid slope: ${edge.slopePct}`);
		}
		if (!ACCESSIBILITY_STATUSES.has(edge.accessibility)) {
			throw new MalformedDataError(
				`Edge ${edge.id} has invalid accessibility: ${String(edge.accessibility)}`
			);
		}
		if (edge.hasStairs && edge.accessibility !== 'inaccessible') {
			throw new MalformedDataError(`Edge ${edge.id} has stairs but is not marked inaccessible`);
		}
	}
}
