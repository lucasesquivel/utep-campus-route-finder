import type { Building, RouteResult } from './types';

/** Visualization interface; route search is deliberately excluded. */
export interface MapRenderer {
  setBuildings(buildings: Building[]): void;
  setRoute(route: RouteResult | null): void;
  destroy(): void;
}
