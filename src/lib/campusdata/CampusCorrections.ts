import { MalformedDataError } from './errors';
import { haversineM } from './geo';
import type { AccessibilityStatus, RawCampusData, RawEdge, RawEntrance, RawNode } from './types';

/** Every correction records how the team verified it (site visit, photo, campus map...). */
interface Verified {
	note: string;
}

/**
 * Manually verified corrections layered on top of an OSM export. Kept in its own file so
 * the original export stays untouched and can be re-downloaded at any time.
 * Ids refer to transformer output: nodes are "n<osm id>", path segments "w<way id>:<index>".
 */
export interface CampusCorrections {
	/** Points missing from OSM (e.g. an unmapped door or path junction). */
	nodes?: (RawNode & Verified)[];
	/** Missing paths or connections. distanceM defaults to the straight line between nodes. */
	edges?: (Omit<RawEdge, 'distanceM'> & { distanceM?: number } & Verified)[];
	/** Entrances added or confirmed by the team; they become source 'verified'. */
	entrances?: (Omit<RawEntrance, 'source'> & Verified)[];
	/** Accessibility observed on existing paths, by edge id (applies to both directions). */
	edgeAccessibility?: ({ edgeId: string; accessibility: AccessibilityStatus } & Verified)[];
}

/**
 * Returns a new RawCampusData with the corrections applied; the input is not modified.
 * A corrected entrance with the same id as a mapped one replaces it. Throws
 * MalformedDataError for a correction without a note or one that names a missing record.
 * Remaining validation (duplicates, dangling ids, values) happens in CampusRepository.
 */
export function applyCorrections(
	data: RawCampusData,
	corrections: CampusCorrections
): RawCampusData {
	for (const node of corrections.nodes ?? []) requireNote(node, `node ${node.id}`);
	const nodes = [...data.nodes, ...(corrections.nodes ?? []).map(stripNote)];
	const nodesById = new Map(nodes.map((n) => [n.id, n] as const));

	const edges: RawEdge[] = data.edges.map((e) => ({ ...e }));
	const edgesById = new Map(edges.map((e) => [e.id, e] as const));
	for (const fix of corrections.edgeAccessibility ?? []) {
		requireNote(fix, `edgeAccessibility ${fix.edgeId}`);
		const target = edgesById.get(fix.edgeId);
		if (!target) {
			throw new MalformedDataError(`Correction names unknown edge: ${fix.edgeId}`);
		}
		target.accessibility = fix.accessibility;
	}
	for (const added of corrections.edges ?? []) {
		requireNote(added, `edge ${added.id}`);
		edges.push({ ...stripNote(added), distanceM: added.distanceM ?? distanceOf(added) });
	}

	const entrances = new Map(data.entrances.map((en) => [en.id, en] as const));
	for (const verified of corrections.entrances ?? []) {
		requireNote(verified, `entrance ${verified.id}`);
		entrances.set(verified.id, { ...stripNote(verified), source: 'verified' });
	}

	return { nodes, edges, buildings: [...data.buildings], entrances: [...entrances.values()] };

	function distanceOf(edge: { id: string; fromId: string; toId: string }): number {
		const from = nodesById.get(edge.fromId);
		const to = nodesById.get(edge.toId);
		if (!from || !to) {
			throw new MalformedDataError(`Correction edge ${edge.id} references an unknown node`);
		}
		return haversineM(from.lat, from.lng, to.lat, to.lng);
	}
}

function requireNote(correction: Partial<Verified>, label: string): void {
	if (typeof correction.note !== 'string' || correction.note.trim() === '') {
		throw new MalformedDataError(`Correction ${label} needs a note saying how it was verified`);
	}
}

function stripNote<T extends Verified>(correction: T): Omit<T, 'note'> {
	const copy: Partial<T> = { ...correction };
	delete copy.note;
	return copy as Omit<T, 'note'>;
}
