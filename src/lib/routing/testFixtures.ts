/**
 * Test-only helpers for the Routing subsystem. Builds small in-memory graphs that behave
 * like the Campus Data CampusGraph contracts Routing relies on (CG-2, CG-3): edges are
 * walkable both ways, distanceM is measured along the geometry, and the reverse traversal
 * negates elevationChangeM and gradePercent. Not imported by production code.
 */
import { haversineDistanceM } from '../shared/haversine';
import type { LngLat } from '../shared/types';
import type {
	AccessibilityStatus,
	CampusGraphView,
	EntranceView,
	GraphNodeView,
	NodeId,
	PathEdgeView,
	PathTraversalView
} from './campusDataView';

/** Reference point near the UTEP campus. */
export const ORIGIN_LNG = -106.5049;
export const ORIGIN_LAT = 31.7709;

/** Meters per degree of latitude (approximately). */
const M_PER_DEG_LAT = 111_195;

/** Converts a local (x east, y north) offset in meters into a [lng, lat] near campus. */
export function at(xM: number, yM: number): LngLat {
	const mPerDegLng = M_PER_DEG_LAT * Math.cos((ORIGIN_LAT * Math.PI) / 180);
	return [ORIGIN_LNG + xM / mPerDegLng, ORIGIN_LAT + yM / M_PER_DEG_LAT];
}

export interface EdgeSpec {
	id?: string;
	from: NodeId;
	to: NodeId;
	kind?: string;
	hasStairs?: boolean | null;
	stepCount?: number | null;
	accessibility?: AccessibilityStatus;
	/** Elevation change from `from` to `to`, or null when unknown. */
	elevationChangeM?: number | null;
	/** Grade from `from` to `to`, or null when unknown. Derived from elevation if omitted. */
	gradePercent?: number | null;
	/** Intermediate geometry points (local meters) between the two nodes. */
	via?: readonly (readonly [number, number])[];
	/** Overrides the geometric distance (must stay >= straight line for valid tests). */
	distanceM?: number;
}

export class FakeCampusGraph implements CampusGraphView {
	private readonly nodeMap = new Map<NodeId, GraphNodeView>();
	private readonly adjacency = new Map<NodeId, PathTraversalView[]>();
	private readonly local = new Map<NodeId, readonly [number, number]>();
	readonly edges: PathEdgeView[] = [];
	/** Counts CG-3 calls so tests can check the search does not over-expand. */
	neighborCalls = 0;

	addNode(id: NodeId, xM: number, yM: number): this {
		this.nodeMap.set(id, Object.freeze({ id, location: at(xM, yM) }));
		this.local.set(id, [xM, yM]);
		this.adjacency.set(id, []);
		return this;
	}

	addEdge(spec: EdgeSpec): PathEdgeView {
		const from = this.nodeMap.get(spec.from);
		const to = this.nodeMap.get(spec.to);
		if (!from || !to) throw new Error(`Unknown node in edge ${spec.from}->${spec.to}`);

		const geometry: LngLat[] = [
			from.location,
			...(spec.via ?? []).map(([x, y]) => at(x, y)),
			to.location
		];
		let measured = 0;
		for (let i = 1; i < geometry.length; i++) {
			measured += haversineDistanceM(geometry[i - 1], geometry[i]);
		}
		const distanceM = spec.distanceM ?? measured;
		const elevationChangeM = spec.elevationChangeM ?? null;
		const gradePercent =
			spec.gradePercent !== undefined
				? spec.gradePercent
				: elevationChangeM === null
					? null
					: (elevationChangeM / distanceM) * 100;

		const edge: PathEdgeView = Object.freeze({
			id: spec.id ?? `${spec.from}-${spec.to}`,
			fromNodeId: spec.from,
			toNodeId: spec.to,
			kind: spec.kind ?? 'footway',
			geometry: Object.freeze(geometry),
			hasStairs: spec.hasStairs ?? false,
			stepCount: spec.stepCount ?? null,
			accessibility: Object.freeze({ status: spec.accessibility ?? 'accessible' })
		});
		this.edges.push(edge);

		const negate = (v: number | null) => (v === null ? null : -v);
		this.adjacency.get(spec.from)!.push(
			Object.freeze({
				edge,
				fromNodeId: spec.from,
				toNodeId: spec.to,
				distanceM,
				elevationChangeM,
				gradePercent
			})
		);
		this.adjacency.get(spec.to)!.push(
			Object.freeze({
				edge,
				fromNodeId: spec.to,
				toNodeId: spec.from,
				distanceM,
				elevationChangeM: negate(elevationChangeM),
				gradePercent: negate(gradePercent)
			})
		);
		return edge;
	}

	getNode(id: NodeId): GraphNodeView | undefined {
		return this.nodeMap.get(id);
	}

	getNeighbors(nodeId: NodeId): readonly PathTraversalView[] {
		this.neighborCalls += 1;
		const list = this.adjacency.get(nodeId);
		if (!list) throw new Error(`UnknownNodeError: ${nodeId}`);
		return list;
	}

	nodeIds(): NodeId[] {
		return [...this.nodeMap.keys()];
	}

	/** Freezes the adjacency lists so tests can prove Routing never mutates the graph. */
	freeze(): this {
		for (const list of this.adjacency.values()) Object.freeze(list);
		return this;
	}
}

export function entrance(
	id: string,
	nodeId: NodeId,
	opts: { hasSteps?: boolean | null; accessibility?: AccessibilityStatus } = {}
): EntranceView {
	return Object.freeze({
		id,
		nodeId,
		hasSteps: opts.hasSteps ?? false,
		accessibility: Object.freeze({ status: opts.accessibility ?? 'accessible' })
	});
}

/** A traversal for strategy unit tests, built without a graph. */
export function traversal(
	overrides: {
		distanceM?: number;
		gradePercent?: number | null;
		elevationChangeM?: number | null;
		kind?: string;
		hasStairs?: boolean | null;
		stepCount?: number | null;
		accessibility?: AccessibilityStatus;
	} = {}
): PathTraversalView {
	const edge: PathEdgeView = {
		id: 'e',
		fromNodeId: 'a',
		toNodeId: 'b',
		kind: overrides.kind ?? 'footway',
		geometry: [at(0, 0), at(overrides.distanceM ?? 40, 0)],
		hasStairs: overrides.hasStairs ?? false,
		stepCount: overrides.stepCount ?? null,
		accessibility: { status: overrides.accessibility ?? 'accessible' }
	};
	return {
		edge,
		fromNodeId: 'a',
		toNodeId: 'b',
		distanceM: overrides.distanceM ?? 40,
		elevationChangeM: overrides.elevationChangeM ?? null,
		gradePercent: overrides.gradePercent ?? null
	};
}
