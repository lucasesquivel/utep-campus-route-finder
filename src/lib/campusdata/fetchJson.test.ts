import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fetchJson } from './fetchJson';
import { StaticFileCampusDataSource } from './StaticFileCampusDataSource';
import { CampusRepository } from './CampusRepository';
import { DataLoadError } from './errors';

afterEach(() => vi.unstubAllGlobals());

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status });

describe('fetchJson', () => {
	it('returns the parsed JSON body', async () => {
		const data = await fetchJson<{ a: number }>('/x.json', async () => jsonResponse({ a: 1 }));
		expect(data).toEqual({ a: 1 });
	});

	it('calls the fetch function it was given with the url', async () => {
		const fetchFn = vi.fn(async () => jsonResponse({}));
		await fetchJson('/data/campus.json', fetchFn);
		expect(fetchFn).toHaveBeenCalledWith('/data/campus.json');
	});

	it('falls back to the global fetch when none is given', async () => {
		const globalFetch = vi.fn(async () => jsonResponse({ ok: true }));
		vi.stubGlobal('fetch', globalFetch);
		expect(await fetchJson('/y.json')).toEqual({ ok: true });
		expect(globalFetch).toHaveBeenCalledTimes(1);
	});

	it('wraps a network failure in DataLoadError that names the url', async () => {
		const failing = async () => {
			throw new TypeError('Failed to fetch');
		};
		const promise = fetchJson('/down.json', failing);
		await expect(promise).rejects.toBeInstanceOf(DataLoadError);
		await expect(promise).rejects.toThrow(/\/down\.json/);
	});

	it('wraps a non-200 response in DataLoadError that includes the status', async () => {
		const promise = fetchJson('/missing.json', async () => jsonResponse({}, 404));
		await expect(promise).rejects.toBeInstanceOf(DataLoadError);
		await expect(promise).rejects.toThrow(/404/);
	});

	it('wraps a body that is not valid JSON in DataLoadError', async () => {
		const promise = fetchJson('/bad.json', async () => new Response('not json {', { status: 200 }));
		await expect(promise).rejects.toBeInstanceOf(DataLoadError);
		await expect(promise).rejects.toThrow(/not valid JSON/);
	});
});

describe('StaticFileCampusDataSource', () => {
	it('defaults to /data/campus.json', async () => {
		const fetchFn = vi.fn(async () => jsonResponse({}));
		await new StaticFileCampusDataSource(undefined, fetchFn as unknown as typeof fetch).load();
		expect(fetchFn).toHaveBeenCalledWith('/data/campus.json');
	});

	it('uses a custom url when given one', async () => {
		const fetchFn = vi.fn(async () => jsonResponse({}));
		await new StaticFileCampusDataSource('/other.json', fetchFn as unknown as typeof fetch).load();
		expect(fetchFn).toHaveBeenCalledWith('/other.json');
	});

	it('loads the real seed file end to end through CampusRepository', async () => {
		const seedText = readFileSync('static/data/campus.json', 'utf8');
		const fetchFn = (async () => new Response(seedText, { status: 200 })) as typeof fetch;
		const repo = new CampusRepository(new StaticFileCampusDataSource('/data/campus.json', fetchFn));
		await repo.loadCampusData();
		expect(repo.getBuildings()).toHaveLength(7);
		expect(repo.getGraph().nodeCount).toBe(13);
	});

	it('surfaces a failed download as DataLoadError from the repository', async () => {
		const fetchFn = (async () => new Response('nope', { status: 500 })) as typeof fetch;
		const repo = new CampusRepository(new StaticFileCampusDataSource('/data/campus.json', fetchFn));
		await expect(repo.loadCampusData()).rejects.toBeInstanceOf(DataLoadError);
	});
});
