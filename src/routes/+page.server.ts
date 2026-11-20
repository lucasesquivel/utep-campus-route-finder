import { listBuildings } from '../lib/server/campus';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ buildings: await listBuildings() });
