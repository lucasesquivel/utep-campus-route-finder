import { json } from '@sveltejs/kit';
import { routeController } from '../../../lib/server/campus';
import { handleRouteApi } from '../../../lib/server/routeApi';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Request body must be JSON.' }, { status: 400 });
	}
	const reply = await handleRouteApi(body, routeController);
	return json(reply.body, { status: reply.status });
};
