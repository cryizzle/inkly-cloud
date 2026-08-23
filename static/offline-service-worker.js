const ASSET_CACHE_NAME = 'inkly-asset-cache-v1';
const ROUTE_CACHE_NAME = 'inkly-route-cache';

async function putSuccessfulResponse(request, response) {
	if (!response.ok) return;
	const url = new URL(request.url);
	const cache = await caches.open(
		request.mode === 'navigate' || url.pathname.endsWith('/__data.json')
			? ROUTE_CACHE_NAME
			: ASSET_CACHE_NAME
	);
	await cache.put(request, response.clone());
}

async function matchCachedRequest(request) {
	const url = new URL(request.url);
	const routeCache = await caches.open(ROUTE_CACHE_NAME);

	if (url.pathname.endsWith('/__data.json')) {
		return routeCache.match(request, { ignoreSearch: true });
	}

	if (request.mode === 'navigate') {
		return routeCache.match(url.pathname) ?? routeCache.match('/');
	}

	return caches.match(request, { ignoreSearch: true });
}

self.addEventListener('install', (event) => {
	self.skipWaiting();
	event.waitUntil(caches.open(ASSET_CACHE_NAME));
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => key !== ASSET_CACHE_NAME && key !== ROUTE_CACHE_NAME)
						.map((key) => caches.delete(key))
				)
			)
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;

	event.respondWith(
		fetch(request)
			.then(async (response) => {
				await putSuccessfulResponse(request, response);
				return response;
			})
			.catch(async () => {
				const cached = await matchCachedRequest(request);
				return cached ?? Response.error();
			})
	);
});
