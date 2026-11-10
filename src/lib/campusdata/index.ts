export { CampusRepository } from './CampusRepository';
export { CampusGraph } from './CampusGraph';
export { RoutingGraphAdapter } from './RoutingGraphAdapter';
export type { CampusDataSource } from './CampusDataSource';
export { StaticFileCampusDataSource } from './StaticFileCampusDataSource';
export { OsmCampusDataSource } from './OsmCampusDataSource';
export { OsmCampusTransformer } from './OsmCampusTransformer';
export { DEFAULT_WALKABLE_HIGHWAYS } from './OsmCampusTransformer';
export { applyCorrections, type CampusCorrections } from './CampusCorrections';
export { findConnectedComponents, describeDisconnectedComponents } from './topology';
export type {
	OsmData,
	OsmElement,
	OsmCampusTransformOptions,
	OsmTransformResult
} from './OsmCampusTransformer';
export * from './errors';
export * from './types';
