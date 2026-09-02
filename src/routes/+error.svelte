<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		loadPageSnapshot,
		type OfflinePageData,
		type OfflineRouteKey
	} from '$lib/client/offline-sync';
	import DeskPage from './+page.svelte';
	import ReadingPage from './reading/+page.svelte';
	import RewardsPage from './rewards/+page.svelte';
	import WritingPage from './writing/+page.svelte';

	type DashboardPageData = Extract<OfflinePageData, { summary: unknown }>;
	type WritingPageData = Extract<OfflinePageData, { page: number }>;
	type ReadingPageData = Extract<OfflinePageData, { stats: unknown; activePage: number; readPage: number }>;
	type RewardsPageData = Extract<OfflinePageData, { milestones: unknown[] }>;

	type CachedPage =
		| { route: 'dashboard'; data: DashboardPageData }
		| { route: 'writing'; data: WritingPageData }
		| { route: 'reading'; data: ReadingPageData }
		| { route: 'rewards'; data: RewardsPageData };

	let cachedPage = $state<CachedPage | null>(null);
	let cacheChecked = $state(false);

	function routeForPath(pathname: string): OfflineRouteKey | null {
		if (pathname === '/') return 'dashboard';
		if (pathname.startsWith('/writing')) return 'writing';
		if (pathname.startsWith('/reading')) return 'reading';
		if (pathname.startsWith('/rewards')) return 'rewards';
		return null;
	}

	function pageNumber(search: URLSearchParams, key: string, fallback: number) {
		const value = Number(search.get(key));
		return Number.isInteger(value) && value > 0 ? value : fallback;
	}

	function applyUrlState(route: 'dashboard', snapshot: DashboardPageData, url: URL): DashboardPageData;
	function applyUrlState(route: 'writing', snapshot: WritingPageData, url: URL): WritingPageData;
	function applyUrlState(route: 'reading', snapshot: ReadingPageData, url: URL): ReadingPageData;
	function applyUrlState(route: 'rewards', snapshot: RewardsPageData, url: URL): RewardsPageData;
	function applyUrlState(route: OfflineRouteKey, snapshot: OfflinePageData, url: URL) {
		if (route === 'writing' && 'page' in snapshot) {
			return {
				...snapshot,
				sort: url.searchParams.get('sort') === 'asc' ? 'asc' : 'desc',
				page: pageNumber(url.searchParams, 'page', snapshot.page)
			};
		}

		if (route === 'reading' && 'activePage' in snapshot) {
			const readingSnapshot = snapshot as ReadingPageData;
			return {
				...readingSnapshot,
				sort: url.searchParams.get('sort') === 'asc' ? 'asc' : 'desc',
				activePage: pageNumber(url.searchParams, 'activePage', readingSnapshot.activePage),
				readPage: pageNumber(url.searchParams, 'readPage', readingSnapshot.readPage)
			};
		}

		if (route === 'rewards' && 'milestones' in snapshot) {
			return {
				...snapshot,
				activePage: pageNumber(url.searchParams, 'activePage', snapshot.activePage),
				earnedPage: pageNumber(url.searchParams, 'earnedPage', snapshot.earnedPage),
				completionPage: pageNumber(url.searchParams, 'completionPage', snapshot.completionPage)
			};
		}

		return snapshot;
	}

	onMount(async () => {
		const route = routeForPath(window.location.pathname);
		if (!route) {
			cacheChecked = true;
			return;
		}

		const snapshot = await loadPageSnapshot<OfflinePageData>(route);
		if (route === 'dashboard' && snapshot && 'summary' in snapshot) {
			cachedPage = { route, data: applyUrlState(route, snapshot, new URL(window.location.href)) };
		}
		if (route === 'writing' && snapshot && 'page' in snapshot) {
			cachedPage = { route, data: applyUrlState(route, snapshot, new URL(window.location.href)) };
		}
		if (route === 'reading' && snapshot && 'readPage' in snapshot) {
			cachedPage = { route, data: applyUrlState(route, snapshot, new URL(window.location.href)) };
		}
		if (route === 'rewards' && snapshot && 'milestones' in snapshot) {
			cachedPage = {
				route,
				data: applyUrlState(route, snapshot, new URL(window.location.href))
			};
		}
		cacheChecked = true;
	});
</script>

{#if cachedPage?.route === 'dashboard'}
	<DeskPage data={cachedPage.data} />
{:else if cachedPage?.route === 'writing'}
	<WritingPage data={cachedPage.data} />
{:else if cachedPage?.route === 'reading'}
	<ReadingPage data={cachedPage.data} />
{:else if cachedPage?.route === 'rewards'}
	<RewardsPage data={cachedPage.data} />
{:else}
	<section class="card stack" style="padding: 1.25rem;">
		<h1 class="display" style="margin: 0;">ink.ly is offline</h1>
		{#if cacheChecked}
			<p class="muted">
				I could not reach the server and do not have a cached copy of this page yet. Reconnect to the VPN,
				open this page once, and it will be available for fallback next time.
			</p>
		{:else}
			<p class="muted">Looking for a cached copy...</p>
		{/if}
		<p class="muted">Original error: {page.status}</p>
	</section>
{/if}
