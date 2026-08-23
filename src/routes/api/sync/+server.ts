import { json } from '@sveltejs/kit';
import { applySyncOperations } from '$lib/server/sync';

export async function POST({ request }) {
	const body = (await request.json()) as { operations?: unknown[] };
	const operations = Array.isArray(body.operations) ? body.operations : [];

	try {
		return json(await applySyncOperations(operations));
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Unable to sync operations.' },
			{ status: 400 }
		);
	}
}
