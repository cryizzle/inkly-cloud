import type {
	DashboardSummary,
	ReadingEntry,
	ReadingStats,
	RewardCompletion,
	RewardMilestoneProgress,
	SyncOperation,
	WritingEntry,
	WritingEntryDerived,
	WritingStats
} from '$lib/types';

const DB_NAME = 'inkly-offline';
const DB_VERSION = 2;
const OUTBOX_STORE = 'outbox';
const SNAPSHOT_STORE = 'snapshots';
const OFFLINE_ROUTES = ['/', '/writing', '/reading', '/rewards'];
const DAY_MS = 24 * 60 * 60 * 1000;

type SnapshotRecord<T> = {
	key: string;
	value: T;
	updatedAt: string;
};

export type OfflineRouteKey = 'dashboard' | 'writing' | 'reading' | 'rewards';

export type OfflinePageData =
	| { summary: DashboardSummary }
	| { stats: WritingStats; sort: 'asc' | 'desc'; page: number; today: string }
	| { stats: ReadingStats; sort: 'asc' | 'desc'; activePage: number; readPage: number; today: string }
	| {
			milestones: RewardMilestoneProgress[];
			activePage: number;
			earnedPage: number;
			completionPage: number;
			completions: (RewardCompletion & { milestoneTitle: string; rewardEur: number | null })[];
	  };

export type OfflineOperationEvent = {
	operation: SyncOperation;
	sourcePath: string;
};

export type OfflineSyncStatus = {
	online: boolean;
	pendingCount: number;
	syncing: boolean;
	message: string;
};

function openOfflineDb() {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
				db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
			}
			if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
				db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'key' });
			}
		};
	});
}

async function withStore<T>(
	storeName: string,
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore) => IDBRequest<T>
) {
	const db = await openOfflineDb();
	return new Promise<T>((resolve, reject) => {
		const transaction = db.transaction(storeName, mode);
		const request = run(transaction.objectStore(storeName));
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
		transaction.oncomplete = () => db.close();
		transaction.onerror = () => {
			db.close();
			reject(transaction.error);
		};
	});
}

export async function listOutbox() {
	return withStore<SyncOperation[]>(OUTBOX_STORE, 'readonly', (store) => store.getAll());
}

export async function outboxCount() {
	return withStore<number>(OUTBOX_STORE, 'readonly', (store) => store.count());
}

export async function enqueueOperation(operation: SyncOperation) {
	await withStore<IDBValidKey>(OUTBOX_STORE, 'readwrite', (store) => store.put(operation));
}

export async function removeOperations(ids: string[]) {
	if (!ids.length) return;

	const db = await openOfflineDb();
	await new Promise<void>((resolve, reject) => {
		const transaction = db.transaction(OUTBOX_STORE, 'readwrite');
		const store = transaction.objectStore(OUTBOX_STORE);
		for (const id of ids) {
			store.delete(id);
		}
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
	db.close();
}

export async function cachePageSnapshot<T>(key: OfflineRouteKey, value: T) {
	await withStore<IDBValidKey>(SNAPSHOT_STORE, 'readwrite', (store) =>
		store.put({ key, value, updatedAt: new Date().toISOString() })
	);
}

export async function loadPageSnapshot<T>(key: OfflineRouteKey) {
	const record = await withStore<SnapshotRecord<T> | undefined>(SNAPSHOT_STORE, 'readonly', (store) =>
		store.get(key)
	);
	return record?.value ?? null;
}

function operationId() {
	if (crypto.randomUUID) {
		return crypto.randomUUID();
	}
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createOperation(type: SyncOperation['type'], formData: FormData): SyncOperation {
	const payload: SyncOperation['payload'] = {};
	for (const [key, value] of formData.entries()) {
		if (typeof value === 'string') {
			payload[key] = value;
		}
	}

	return {
		id: operationId(),
		type,
		payload,
		createdAt: new Date().toISOString()
	};
}

async function postOperations(operations: SyncOperation[]) {
	const response = await fetch('/api/sync', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ operations })
	});

	if (!response.ok) {
		let message = `Sync failed with status ${response.status}.`;
		try {
			const body = (await response.json()) as { error?: string };
			if (body.error) {
				message = body.error;
			}
		} catch (error) {
			// Keep the HTTP status message when the response is not JSON.
		}
		throw new Error(message);
	}

	const result = (await response.json()) as {
		applied?: string[];
		skipped?: string[];
		summary?: DashboardSummary;
	};
	if (result.summary) {
		await cachePageSnapshot('dashboard', { summary: result.summary });
	}
	return [...(result.applied ?? []), ...(result.skipped ?? [])];
}

export async function syncPendingOperations() {
	if (!navigator.onLine) {
		return { synced: 0, pending: await outboxCount() };
	}

	const queued = await listOutbox();
	if (!queued.length) {
		return { synced: 0, pending: 0 };
	}

	const completedIds = await postOperations(queued);
	await removeOperations(completedIds);
	return { synced: completedIds.length, pending: await outboxCount() };
}

export async function warmOfflineCache() {
	if (!navigator.onLine || !('caches' in window)) return;

	const cache = await caches.open('inkly-route-cache');
	const urls = OFFLINE_ROUTES.flatMap((route) => [route, `${route === '/' ? '' : route}/__data.json`]);

	await Promise.allSettled(
		urls.map(async (url) => {
			const response = await fetch(url, { credentials: 'same-origin' });
			if (response.ok) {
				await cache.put(url, response.clone());
			}
		})
	);
}

export async function submitOrQueue(operation: SyncOperation) {
	const queued = await listOutbox();
	if (!navigator.onLine) {
		await enqueueOperation(operation);
		announceOfflineOperation(operation);
		return { queued: true, synced: 0, pending: queued.length + 1 };
	}

	try {
		const completedIds = await postOperations([...queued, operation]);
		await removeOperations(completedIds);
		return { queued: false, synced: completedIds.length, pending: await outboxCount() };
	} catch (error) {
		console.warn('ink.ly sync failed; queued operation locally.', error, operation);
		await enqueueOperation(operation);
		announceOfflineOperation(operation);
		return { queued: true, synced: 0, pending: queued.length + 1 };
	}
}

export function announceOfflineSync(status: OfflineSyncStatus) {
	window.dispatchEvent(new CustomEvent<OfflineSyncStatus>('inkly-offline-sync', { detail: status }));
}

export function announceOfflineOperation(operation: SyncOperation) {
	window.dispatchEvent(
		new CustomEvent<OfflineOperationEvent>('inkly-offline-operation', {
			detail: { operation, sourcePath: window.location.pathname }
		})
	);
}

function localId() {
	return -Math.floor(Date.now() + Math.random() * 1000);
}

function numberFromPayload(payload: Record<string, string>, key: string, fallback = 0) {
	const value = Number(payload[key] ?? fallback);
	return Number.isFinite(value) ? value : fallback;
}

function stringFromPayload(payload: Record<string, string>, key: string, fallback = '') {
	const value = payload[key]?.trim();
	return value || fallback;
}

function nullableFromPayload(payload: Record<string, string>, key: string) {
	const value = payload[key]?.trim();
	return value || null;
}

function diffDays(left: string, right: string) {
	return Math.round((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / DAY_MS);
}

function calculateSlidingCycleProgress(dates: string[], target: number, referenceDate: string) {
	const ordered = [...new Set(dates)].filter(Boolean).sort();
	if (!ordered.length) {
		return { startDate: null, endDate: null, currentCount: 0, target, progressPct: 0 };
	}

	let startIndex = 0;
	let bestStart = ordered[0];
	let bestCount = 0;

	for (let index = 0; index < ordered.length; index += 1) {
		while (diffDays(ordered[startIndex], ordered[index]) >= 30) {
			startIndex += 1;
		}
		const count = index - startIndex + 1;
		if (count >= target) {
			startIndex = index + 1;
			bestStart = ordered[startIndex] ?? ordered[index];
			bestCount = 0;
		} else {
			bestStart = ordered[startIndex];
			bestCount = count;
		}
	}

	const startDate = bestStart ?? referenceDate;
	const endDate = new Date(Date.parse(`${startDate}T00:00:00Z`) + 29 * DAY_MS)
		.toISOString()
		.slice(0, 10);

	return {
		startDate,
		endDate,
		currentCount: bestCount,
		target,
		progressPct: Math.min(100, Math.round((bestCount / target) * 100))
	};
}

function deriveWritingEntries(entries: WritingEntry[]): WritingEntryDerived[] {
	const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
	let previousEnding: number | null = null;
	let cumulativeAbs = 0;
	let streak = 0;
	let previousDate: string | null = null;

	return sorted.map((entry) => {
		const startingWordCount = previousEnding;
		const diff = startingWordCount === null ? 0 : entry.endingWordCount - startingWordCount;
		const diffAbs = Math.abs(diff);
		cumulativeAbs += diffAbs;
		streak = previousDate && diffDays(previousDate, entry.date) === 1 ? (streak >= 5 ? 1 : streak + 1) : 1;
		previousEnding = entry.endingWordCount;
		previousDate = entry.date;
		return { ...entry, startingWordCount, diff, diffAbs, cumulativeAbs, editingStreak: streak };
	});
}

function getWritingStats(entries: WritingEntry[], today: string): WritingStats {
	const derived = deriveWritingEntries(entries);
	const latest = derived.at(-1);
	return {
		entries: derived,
		currentEndingWordCount: latest?.endingWordCount ?? 0,
		currentStreak: latest?.editingStreak ?? 0,
		cumulativeAbsWords: latest?.cumulativeAbs ?? 0,
		totalEditingDays: derived.length,
		cycle: calculateSlidingCycleProgress(
			derived.map((entry) => entry.date),
			15,
			today
		)
	};
}

function getReadingStats(entries: ReadingEntry[], today: string): ReadingStats {
	const completed = entries.filter((entry) => entry.status === 'Read');
	const qualifyingDates = entries
		.filter((entry) => entry.status === 'Read' && !!entry.finishedAt)
		.map((entry) => entry.finishedAt!);
	return {
		entries: [...entries].sort((a, b) => (a.finishedAt ?? a.title).localeCompare(b.finishedAt ?? b.title)),
		completedBooks: completed.length,
		currentReadingCycle: calculateSlidingCycleProgress(qualifyingDates, 3, today)
	};
}

function patchWritingData(
	data: Extract<OfflinePageData, { stats: WritingStats; page: number }>,
	operation: SyncOperation
) {
	const entries = data.stats.entries.map(({ id, date, endingWordCount }) => ({ id, date, endingWordCount }));
	const payload = operation.payload;

	if (operation.type === 'writing.create') {
		const date = stringFromPayload(payload, 'date');
		const existing = entries.find((entry) => entry.date === date);
		if (existing) {
			existing.endingWordCount = numberFromPayload(payload, 'endingWordCount');
		} else {
			entries.push({
				id: localId(),
				date,
				endingWordCount: numberFromPayload(payload, 'endingWordCount')
			});
		}
	}

	if (operation.type === 'writing.update') {
		const id = numberFromPayload(payload, 'id');
		const index = entries.findIndex((entry) => entry.id === id);
		if (index >= 0) {
			entries[index] = {
				...entries[index],
				date: stringFromPayload(payload, 'date', entries[index].date),
				endingWordCount: numberFromPayload(payload, 'endingWordCount', entries[index].endingWordCount)
			};
		}
	}

	if (operation.type === 'writing.delete') {
		const id = numberFromPayload(payload, 'id');
		return { ...data, stats: getWritingStats(entries.filter((entry) => entry.id !== id), data.today) };
	}

	return { ...data, stats: getWritingStats(entries, data.today) };
}

function patchReadingData(
	data: Extract<OfflinePageData, { stats: ReadingStats; activePage: number }>,
	operation: SyncOperation
) {
	let entries = [...data.stats.entries];
	const payload = operation.payload;

	if (operation.type === 'reading.create') {
		entries = [
			...entries,
			{
				id: localId(),
				status: stringFromPayload(payload, 'status', 'Want to Read') as ReadingEntry['status'],
				verifiedComp: payload.verifiedComp === 'true',
				title: stringFromPayload(payload, 'title'),
				author: stringFromPayload(payload, 'author'),
				genreText: nullableFromPayload(payload, 'genreText'),
				remarks: nullableFromPayload(payload, 'remarks'),
				similarities: nullableFromPayload(payload, 'similarities'),
				liked: nullableFromPayload(payload, 'liked'),
				disliked: nullableFromPayload(payload, 'disliked'),
				finishedAt: nullableFromPayload(payload, 'finishedAt')
			}
		];
	}

	if (operation.type === 'reading.update') {
		const id = numberFromPayload(payload, 'id');
		entries = entries.map((entry) =>
			entry.id === id
				? {
						...entry,
						status: stringFromPayload(payload, 'status', entry.status) as ReadingEntry['status'],
						verifiedComp: payload.verifiedComp === 'true',
						title: stringFromPayload(payload, 'title', entry.title),
						author: stringFromPayload(payload, 'author', entry.author),
						genreText: nullableFromPayload(payload, 'genreText'),
						remarks: nullableFromPayload(payload, 'remarks'),
						similarities: nullableFromPayload(payload, 'similarities'),
						liked: nullableFromPayload(payload, 'liked'),
						disliked: nullableFromPayload(payload, 'disliked'),
						finishedAt: nullableFromPayload(payload, 'finishedAt')
					}
				: entry
		);
	}

	if (operation.type === 'reading.delete') {
		const id = numberFromPayload(payload, 'id');
		entries = entries.filter((entry) => entry.id !== id);
	}

	return { ...data, stats: getReadingStats(entries, data.today) };
}

function patchRewardsData(
	data: Extract<OfflinePageData, { milestones: RewardMilestoneProgress[] }>,
	operation: SyncOperation
) {
	let milestones = [...data.milestones];
	const payload = operation.payload;

	if (operation.type === 'reward.create') {
		milestones = [
			...milestones,
			{
				id: localId(),
				category: stringFromPayload(payload, 'category'),
				title: stringFromPayload(payload, 'title'),
				rewardEur: numberFromPayload(payload, 'rewardEur'),
				kind: stringFromPayload(payload, 'kind', 'manual') as RewardMilestoneProgress['kind'],
				metricType: stringFromPayload(payload, 'metricType', 'manual') as RewardMilestoneProgress['metricType'],
				targetValue: numberFromPayload(payload, 'targetValue') || null,
				isRepeatable: payload.isRepeatable === 'true',
				status: 'pending',
				completedAt: null,
				progressValue: null,
				progressLabel: 'Manual milestone',
				completionCount: 0,
				latestCompletion: null
			}
		];
	}

	if (operation.type === 'reward.update') {
		const id = numberFromPayload(payload, 'id');
		milestones = milestones.map((milestone) =>
			milestone.id === id
				? {
						...milestone,
						category: stringFromPayload(payload, 'category', milestone.category),
						title: stringFromPayload(payload, 'title', milestone.title),
						rewardEur: numberFromPayload(payload, 'rewardEur', milestone.rewardEur),
						targetValue: numberFromPayload(payload, 'targetValue') || null
					}
				: milestone
		);
	}

	if (operation.type === 'reward.toggleManual') {
		const id = numberFromPayload(payload, 'id');
		const shouldComplete = payload.shouldComplete === 'true';
		const completedAt = nullableFromPayload(payload, 'completedAt') ?? new Date().toISOString().slice(0, 10);
		milestones = milestones.map((milestone) =>
			milestone.id === id
				? {
						...milestone,
						status: shouldComplete ? 'earned' : 'pending',
						completedAt: shouldComplete ? completedAt : null,
						latestCompletion: shouldComplete ? completedAt : null
					}
				: milestone
		);
	}

	if (operation.type === 'reward.delete') {
		const id = numberFromPayload(payload, 'id');
		milestones = milestones.filter((milestone) => milestone.id !== id);
	}

	return { ...data, milestones };
}

export function applyOperationToPageData<T extends OfflinePageData>(
	route: OfflineRouteKey,
	data: T,
	operation: SyncOperation
) {
	if (route === 'writing' && operation.type.startsWith('writing.')) {
		return patchWritingData(data as Extract<OfflinePageData, { stats: WritingStats; page: number }>, operation) as T;
	}
	if (route === 'reading' && operation.type.startsWith('reading.')) {
		return patchReadingData(data as Extract<OfflinePageData, { stats: ReadingStats; activePage: number }>, operation) as T;
	}
	if (route === 'rewards' && operation.type.startsWith('reward.')) {
		return patchRewardsData(data as Extract<OfflinePageData, { milestones: RewardMilestoneProgress[] }>, operation) as T;
	}
	return data;
}
