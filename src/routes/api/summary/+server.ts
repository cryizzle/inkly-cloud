import { json } from '@sveltejs/kit';
import { getDashboardSummary } from '$lib/server/data';

export function GET() {
	return json(getDashboardSummary());
}
