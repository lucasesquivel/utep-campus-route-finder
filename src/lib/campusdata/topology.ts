import type { RawCampusData } from './types';

/** Most disconnected components to describe one by one in warnings. */
const MAX_LISTED_COMPONENTS = 25;

/**
 * Groups node ids into connected components of the path network, treating every edge as
 * walkable both ways (one-way edges still connect their nodes physically). Largest first.
 */
export function findConnectedComponents(data: RawCampusData): string[][] {
	const neighbors = new Map<string, string[]>(data.nodes.map((n) => [n.id, []]));
	for (const edge of data.edges) {
		neighbors.get(edge.fromId)?.push(edge.toId);
		neighbors.get(edge.toId)?.push(edge.fromId);
	}

	const seen = new Set<string>();
	const components: string[][] = [];
	for (const start of neighbors.keys()) {
		if (seen.has(start)) continue;
		const component: string[] = [];
		const stack = [start];
		seen.add(start);
		while (stack.length > 0) {
			const nodeId = stack.pop()!;
			component.push(nodeId);
			for (const next of neighbors.get(nodeId) ?? []) {
				if (!seen.has(next)) {
					seen.add(next);
					stack.push(next);
				}
			}
		}
		components.push(component);
	}
	return components.sort((a, b) => b.length - a.length);
}

/**
 * Human-readable warnings about parts of the network that cannot reach the largest
 * component. Components holding building entrances are listed individually, since routes
 * to or from those buildings will fail; the rest are summarized.
 */
export function describeDisconnectedComponents(data: RawCampusData): string[] {
	const components = findConnectedComponents(data);
	if (components.length <= 1) return [];

	const buildingNames = new Map(data.buildings.map((b) => [b.id, b.name] as const));
	const entrancesByNode = new Map<string, string[]>();
	for (const entrance of data.entrances) {
		const label = `${buildingNames.get(entrance.buildingId) ?? entrance.buildingId} (${entrance.id})`;
		entrancesByNode.set(entrance.nodeId, [...(entrancesByNode.get(entrance.nodeId) ?? []), label]);
	}

	const warnings = [
		`Path network has ${components.length} disconnected components; the largest has ${components[0].length} nodes`
	];
	let unlistedCount = 0;
	let unlistedNodes = 0;
	let listed = 0;
	for (const component of components.slice(1)) {
		const entrances = component.flatMap((nodeId) => entrancesByNode.get(nodeId) ?? []);
		if (entrances.length > 0 && listed < MAX_LISTED_COMPONENTS) {
			listed++;
			warnings.push(
				`Disconnected component of ${component.length} nodes (e.g. ${component[0]}) holds entrances: ${entrances.join(', ')}`
			);
		} else {
			unlistedCount++;
			unlistedNodes += component.length;
		}
	}
	if (unlistedCount > 0) {
		warnings.push(
			`${unlistedCount} other disconnected components (${unlistedNodes} nodes) hold no listed entrances`
		);
	}
	return warnings;
}
