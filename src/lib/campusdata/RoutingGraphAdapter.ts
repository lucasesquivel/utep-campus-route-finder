import type { CampusGraph } from './CampusGraph';
import type {
	AccessibilityInfo,
	AccessibilityStatus,
	Entrance,
	GraphNode,
	PathEdge,
	PathTraversal,
	RoutingEdge,
	RoutingEntrance,
	RoutingNode
} from './types';

const ACCESSIBILITY_INFO: Readonly<Record<AccessibilityStatus, AccessibilityInfo>> = Object.freeze({
	accessible: Object.freeze({ status: 'accessible' }),
	inaccessible: Object.freeze({ status: 'inaccessible' }),
	unknown: Object.freeze({ status: 'unknown' })
});

/**
 * Presents a CampusGraph in the shape the Routing subsystem reads: node lookup (CG-2) and
 * direction-resolved neighbor traversals (CG-3). It converts facts only and adds no costs.
 *
 * Each stored directed edge (including the generated "<id>:rev" reverse edge) becomes its own
 * RoutingEdge, so a traversal always runs in its edge's stored direction. Geometry is the
 * straight segment between the two nodes, which matches OSM-derived edges (one per segment).
 *
 * Accessibility keeps all three states, so Routing can tell verified paths from 'unknown'
 * ones. Step counts and entrance steps are not in the model, so they are reported as null.
 *
 * The adapter holds no state of its own; it reads the wrapped graph on every call.
 */
export class RoutingGraphAdapter {
	private readonly graph: CampusGraph;

	constructor(graph: CampusGraph) {
		this.graph = graph;
	}

	/** CG-2: the node with this id, or undefined for an unknown id. */
	getNode(id: string): RoutingNode | undefined {
		const node = this.graph.getNode(id);
		return node && RoutingGraphAdapter.toRoutingNode(node);
	}

	/** CG-3: traversals leaving nodeId. Throws NotFoundError for an unknown node. */
	getNeighbors(nodeId: string): readonly PathTraversal[] {
		return this.graph.getNeighbors(nodeId).map((edge) => this.toTraversal(edge));
	}

	/** CD-4: an entrance as Routing reads it. */
	static toRoutingEntrance(entrance: Entrance): RoutingEntrance {
		return {
			id: entrance.id,
			buildingId: entrance.buildingId,
			nodeId: entrance.nodeId,
			hasSteps: null,
			accessibility: ACCESSIBILITY_INFO[entrance.accessibility],
			source: entrance.source
		};
	}

	private toTraversal(edge: PathEdge): PathTraversal {
		// CampusGraph only stores edges whose endpoints exist, so both lookups succeed.
		const from = this.graph.getNode(edge.fromId)!;
		const to = this.graph.getNode(edge.toId)!;
		const elevationChangeM =
			from.elevationM !== undefined && to.elevationM !== undefined
				? to.elevationM - from.elevationM
				: null;
		return {
			edge: RoutingGraphAdapter.toRoutingEdge(edge, from, to),
			fromNodeId: edge.fromId,
			toNodeId: edge.toId,
			distanceM: edge.distanceM,
			elevationChangeM,
			gradePercent: edge.slopePct ?? null
		};
	}

	private static toRoutingEdge(edge: PathEdge, from: GraphNode, to: GraphNode): RoutingEdge {
		return {
			id: edge.id,
			fromNodeId: edge.fromId,
			toNodeId: edge.toId,
			kind: edge.hasStairs ? 'steps' : 'path',
			geometry: [
				[from.lng, from.lat],
				[to.lng, to.lat]
			],
			hasStairs: edge.hasStairs,
			stepCount: null,
			hasRamp: edge.hasRamp,
			accessibility: ACCESSIBILITY_INFO[edge.accessibility]
		};
	}

	private static toRoutingNode(node: GraphNode): RoutingNode {
		return { id: node.id, location: [node.lng, node.lat] };
	}
}
