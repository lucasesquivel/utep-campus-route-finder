import { MalformedDataError, NotFoundError } from './errors';
import type { GraphNode, PathEdge } from './types';

/** Directed graph of walkable nodes and path edges, with adjacency lookup. */
export class CampusGraph {
	private readonly nodes = new Map<string, GraphNode>();
	private readonly adjacency = new Map<string, PathEdge[]>();
	private readonly edgeIds = new Set<string>();

	addNode(node: GraphNode): void {
		if (!node.id) throw new MalformedDataError('Node is missing an id');
		if (this.nodes.has(node.id)) throw new MalformedDataError(`Duplicate node id: ${node.id}`);
		if (!Number.isFinite(node.lat) || node.lat < -90 || node.lat > 90) {
			throw new MalformedDataError(`Node ${node.id} has invalid latitude: ${node.lat}`);
		}
		if (!Number.isFinite(node.lng) || node.lng < -180 || node.lng > 180) {
			throw new MalformedDataError(`Node ${node.id} has invalid longitude: ${node.lng}`);
		}
		if (node.elevationM !== undefined && !Number.isFinite(node.elevationM)) {
			throw new MalformedDataError(`Node ${node.id} has invalid elevation: ${node.elevationM}`);
		}
		this.nodes.set(node.id, node);
		this.adjacency.set(node.id, []);
	}

	/** Adds one directed edge. Both endpoint nodes must already exist. */
	addEdge(edge: PathEdge): void {
		if (!edge.id) throw new MalformedDataError('Edge is missing an id');
		if (this.edgeIds.has(edge.id)) throw new MalformedDataError(`Duplicate edge id: ${edge.id}`);
		if (!this.nodes.has(edge.fromId)) {
			throw new MalformedDataError(`Edge ${edge.id} references unknown node: ${edge.fromId}`);
		}
		if (!this.nodes.has(edge.toId)) {
			throw new MalformedDataError(`Edge ${edge.id} references unknown node: ${edge.toId}`);
		}
		if (!Number.isFinite(edge.distanceM) || edge.distanceM < 0) {
			throw new MalformedDataError(`Edge ${edge.id} has invalid distance: ${edge.distanceM}`);
		}
		if (edge.slopePct !== undefined && !Number.isFinite(edge.slopePct)) {
			throw new MalformedDataError(`Edge ${edge.id} has invalid slope: ${edge.slopePct}`);
		}
		this.edgeIds.add(edge.id);
		this.adjacency.get(edge.fromId)!.push(edge);
	}

	hasNode(id: string): boolean {
		return this.nodes.has(id);
	}

	getNode(id: string): GraphNode | undefined {
		return this.nodes.get(id);
	}

	/** Outgoing edges from a node. Throws NotFoundError if the node does not exist. */
	getNeighbors(nodeId: string): PathEdge[] {
		const edges = this.adjacency.get(nodeId);
		if (!edges) throw new NotFoundError(`Unknown node: ${nodeId}`);
		return [...edges];
	}

	getNodes(): GraphNode[] {
		return [...this.nodes.values()];
	}

	get nodeCount(): number {
		return this.nodes.size;
	}

	get edgeCount(): number {
		return this.edgeIds.size;
	}
}