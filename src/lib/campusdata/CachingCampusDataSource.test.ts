import { describe, expect, it, vi } from 'vitest';

import type { CampusDataSource } from './CampusDataSource';
import { CachingCampusDataSource } from './CachingCampusDataSource';

type LoadedData = Awaited<ReturnType<CampusDataSource['load']>>;

describe('CachingCampusDataSource', () => {
  it('loads data once and reuses the cached result', async () => {
    const data = {} as LoadedData;
    const load = vi.fn(async () => data);

    const decorator = new CachingCampusDataSource({ load });

    const first = await decorator.load();
    const second = await decorator.load();

    expect(first).toBe(data);
    expect(second).toBe(data);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shares an in-progress load between concurrent callers', async () => {
    const data = {} as LoadedData;
    const load = vi.fn(async () => data);

    const decorator = new CachingCampusDataSource({ load });

    const first = decorator.load();
    const second = decorator.load();

    expect(first).toBe(second);

    const results = await Promise.all([first, second]);

    expect(results).toEqual([data, data]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed load', async () => {
    const data = {} as LoadedData;

    const load = vi
      .fn<CampusDataSource['load']>()
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValueOnce(data);

    const decorator = new CachingCampusDataSource({ load });

    await expect(decorator.load()).rejects.toThrow(
      'Temporary failure'
    );

    await expect(decorator.load()).resolves.toBe(data);

    expect(load).toHaveBeenCalledTimes(2);
  });
});
