import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { CampusRepository } from '../campusdata/CampusRepository';
import type { RawCampusData } from '../campusdata/types';
import { BuildingCatalog } from './BuildingCatalog';

function createRepository() {
  const seed = JSON.parse(
    readFileSync('static/data/campus.json', 'utf8')
  ) as RawCampusData;

  return new CampusRepository({
    load: async () => structuredClone(seed)
  });
}

describe('BuildingCatalog', () => {
  it('returns buildings with valid marker coordinates', async () => {
    const repository = createRepository();
    await repository.loadCampusData();

    const catalog = new BuildingCatalog(repository);
    const buildings = catalog.listBuildings();

    expect(buildings.length).toBeGreaterThan(0);

    for (const building of buildings) {
      expect(Number.isFinite(building.coordinates[0])).toBe(true);
      expect(Number.isFinite(building.coordinates[1])).toBe(true);
    }
  });

  it('excludes configured building IDs', async () => {
    const repository = createRepository();
    await repository.loadCampusData();

    const catalog = new BuildingCatalog(
      repository,
      new Set(['b_union'])
    );

    const ids = catalog.listBuildings().map((b) => b.id);

    expect(ids).not.toContain('b_union');
    expect(ids).toContain('b_eng');
  });

  it('does not modify the repository building collection', async () => {
    const repository = createRepository();
    await repository.loadCampusData();

    const originalIds = repository.getBuildings().map((b) => b.id);

    const catalog = new BuildingCatalog(
      repository,
      new Set(['b_union'])
    );

    catalog.listBuildings();

    expect(repository.getBuildings().map((b) => b.id)).toEqual(originalIds);
  });
  
  it('returns each building ID only once when source records are duplicated', async () => {
  const repository = createRepository();
  await repository.loadCampusData();

  const originalBuildings = repository.getBuildings();

  // Simulate duplicate records being returned by the data layer.
  vi.spyOn(repository, 'getBuildings').mockReturnValue([
    ...originalBuildings,
    originalBuildings[0]
  ]);

  const catalog = new BuildingCatalog(
    repository,
    new Set()
  );

  const buildings = catalog.listBuildings();
  const ids = buildings.map((building) => building.id);

  expect(ids.length).toBe(new Set(ids).size);
});
});
