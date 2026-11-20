import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GET } from './+server';

/** Calls the GET handler the way SvelteKit would, with a stand-in for event.fetch. */
function callGet(fetchImpl: (url: string) => Promise<Response>) {
	const event = { fetch: fetchImpl } as unknown as Parameters<typeof GET>[0];
	return GET(event) as Promise<Response>;
}

const seedText = () => readFileSync('static/data/campus.json', 'utf8');

describe('GET /campus-data-example', () => {
	it('asks for /data/campus.json with the event fetch', async () => {
		const urls: string[] = [];
		await callGet(async (url) => {
			urls.push(url);
			return new Response(seedText(), { status: 200 });
		});
		expect(urls).toEqual(['/data/campus.json']);
	});

	it('answers 200 with counts and every building with its entrances', async () => {
		const res = await callGet(async () => new Response(seedText(), { status: 200 }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.nodeCount).toBe(13);
		expect(body.buildings).toHaveLength(7);
		const eng = body.buildings.find((b: { id: string }) => b.id === 'b_eng');
		expect(eng.entrances.map((e: { id: string }) => e.id)).toEqual(['en_eng_main', 'en_eng_side']);
		expect(eng.entrances[1]).toMatchObject({ accessibility: 'inaccessible', source: 'mapped' });
	});

	it('answers 500 DataLoadError when the data file cannot be downloaded', async () => {
		const res = await callGet(async () => new Response('missing', { status: 404 }));
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.error).toBe('DataLoadError');
		expect(body.message).toMatch(/404/);
	});

	it('answers 500 MalformedDataError when the data file is invalid', async () => {
		const bad = JSON.parse(seedText());
		bad.nodes.push({ ...bad.nodes[0] }); // duplicate node id
		const res = await callGet(async () => new Response(JSON.stringify(bad), { status: 200 }));
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.error).toBe('MalformedDataError');
		expect(body.message).toMatch(/Duplicate node id/);
	});
});
