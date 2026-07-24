import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { assertProductionAuthConfigured, isAuthEnabled, isAuthenticated, isValidToken, setAuthCookie } from '$lib/server/auth';
import { ensureInitialized } from '$lib/server/db';
import { initializeSchemaAndSeed } from '$lib/server/seed';
import { recalculateRewards } from '$lib/server/rewards';

async function initializeApp() {
	assertProductionAuthConfigured();
	await initializeSchemaAndSeed();
	await recalculateRewards();
}

const publicPrefixes = ['/login', '/healthz', '/_app/', '/favicon', '/robots.txt'];

function isPublicPath(pathname: string) {
	return publicPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

export const handle: Handle = async ({ event, resolve }) => {
	await ensureInitialized(initializeApp);
	event.locals.dbReady = true;

	if (isAuthEnabled() && !isPublicPath(event.url.pathname)) {
		const queryToken = event.url.searchParams.get('token');
		if (isValidToken(queryToken)) {
			setAuthCookie(event.cookies, queryToken!);
			event.url.searchParams.delete('token');
			throw redirect(303, `${event.url.pathname}${event.url.search}${event.url.hash}`);
		}

		if (!isAuthenticated(event)) {
			if (event.url.pathname.startsWith('/api/')) {
				return new Response(JSON.stringify({ error: 'Unauthorized' }), {
					status: 401,
					headers: { 'content-type': 'application/json' }
				});
			}

			throw redirect(303, `/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
		}
	}

	return resolve(event);
};
