/**
 * Read-only view of the Campus Data records that Routing consumes.
 *
 * Routing does not own these records (SDD 2.2.3 boundary; Section 6 owns them). These
 * interfaces list only the fields Routing actually reads, so the full Campus Data types
 * (GraphNode, PathEdge, PathTraversal, AccessibilityInfo, Entrance, CampusGraph) satisfy
 * them structurally. The Controller can pass the real CampusGraph to RouteEngine as-is.
 *
 * Integration note: these assume NodeId is a string. If Campus Data settles on another id
 * type, change NodeId here only.
 */
import type { LngLat } from '../shared/types';

/** Identifier of a graph node (Section 6.5). */
export type NodeId = string;

/** Accessibility status of a path or entrance (Section 6.6 AccessibilityInfo.status). */
export type AccessibilityStatus = 'accessible' | 'inaccessible' | 'unknown';

/** AccessibilityInfo fields read by Routing. */
export interface AccessibilityView {
	readonly status: AccessibilityStatus;
}

/** GraphNode fields read by Routing (CG-2). */
export interface GraphNodeView {
	readonly id: NodeId;
	readonly location: LngLat;
}

/** PathEdge fields read by Routing (Section 6.6). Facts only: Campus Data stores no costs. */
export interface PathEdgeView {
	readonly id: string;
	readonly fromNodeId: NodeId;
	readonly toNodeId: NodeId;
	/** Path kind; the value 'steps' marks a staircase (CD-1 step 6). */
	readonly kind: string;
	/** Geometry from fromNodeId to toNodeId in stored direction. */
	readonly geometry: readonly LngLat[];
	readonly hasStairs: boolean | null;
	readonly stepCount: number | null;
	readonly accessibility: AccessibilityView;
}

/**
 * One path resolved for a direction of travel (CG-3). Grade and elevation change are
 * signed for this direction and are null when unknown.
 */
export interface PathTraversalView {
	readonly edge: PathEdgeView;
	readonly fromNodeId: NodeId;
	readonly toNodeId: NodeId;
	readonly distanceM: number;
	readonly elevationChangeM: number | null;
	readonly gradePercent: number | null;
}

/** Entrance fields read by Routing (Section 6.8). */
export interface EntranceView {
	readonly id: string;
	readonly nodeId: NodeId;
	readonly hasSteps: boolean | null;
	readonly accessibility: AccessibilityView;
}

/** The two CampusGraph contracts Routing calls: CG-2 (node lookup) and CG-3 (neighbors). */
export interface CampusGraphView {
	/** CG-2: node by id, or undefined for an unknown id. */
	getNode(id: NodeId): GraphNodeView | undefined;
	/** CG-3: traversals leaving nodeId, each with fromNodeId === nodeId. */
	getNeighbors(nodeId: NodeId): readonly PathTraversalView[];
}

/** True when the edge is a staircase by either Campus Data fact (hasStairs or kind steps). */
export function edgeHasStairs(edge: PathEdgeView): boolean {
	return edge.hasStairs === true || edge.kind === 'steps';
}
