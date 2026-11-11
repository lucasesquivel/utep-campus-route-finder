import { describe, expect, it, vi, afterEach } from 'vitest';
import { HttpRouteService, parseRouteResult } from './RouteService';
import { NoRouteError } from './types';

afterEach(() => vi.unstubAllGlobals());

describe('route response boundary', () => {
  it('accepts a valid route', () => {
    expect(parseRouteResult({ coordinates: [[-106.5, 31.77], [-106.51, 31.78]], distanceMeters: 300, estimatedMinutes: 5 }))
      .toMatchObject({ distanceMeters: 300, estimatedMinutes: 5 });
  });
  it('rejects missing or invalid route geometry', () => {
    expect(() => parseRouteResult({ coordinates: [] })).toThrow(/coordinates/);
    expect(() => parseRouteResult({ coordinates: [[1000, 31], [0, 0]] })).toThrow(/coordinates/);
  });
  it('distinguishes a no-route result', () => {
    expect(() => parseRouteResult({ status: 'no_route' })).toThrow(NoRouteError);
  });
});

describe('HttpRouteService', () => {
  it('posts the selected buildings and mode to the Controller', async () => {
    const mockedFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ coordinates: [[-106.5, 31.77], [-106.51, 31.78]] }) });
    vi.stubGlobal('fetch', mockedFetch);
    const request = { startBuildingId: 'library', destinationBuildingId: 'union', mode: 'ada' as const };
    await new HttpRouteService('/api/route').getRoute(request);
    expect(mockedFetch).toHaveBeenCalledWith('/api/route', expect.objectContaining({ method: 'POST', body: JSON.stringify(request) }));
  });
  it('reports non-success HTTP responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(new HttpRouteService().getRoute({ startBuildingId: 'a', destinationBuildingId: 'b', mode: 'easy' })).rejects.toThrow(/500/);
  });
});
