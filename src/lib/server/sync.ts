import { eq } from 'drizzle-orm';
import type { SyncOperation } from '$lib/types';
import { getDashboardSummary } from './data';
import { getDb } from './db';
import {
	createReadingEntry,
	createRewardMilestone,
	createWritingEntry,
	deleteReadingEntry,
	deleteRewardMilestone,
	deleteWritingEntry,
	toggleManualReward,
	updateReadingEntry,
	updateRewardMilestone,
	updateWritingEntry
} from './mutations';
import { syncOperations } from './schema';

const operationHandlers = {
	'writing.create': createWritingEntry,
	'writing.update': updateWritingEntry,
	'writing.delete': deleteWritingEntry,
	'reading.create': createReadingEntry,
	'reading.update': updateReadingEntry,
	'reading.delete': deleteReadingEntry,
	'reward.create': createRewardMilestone,
	'reward.update': updateRewardMilestone,
	'reward.delete': deleteRewardMilestone,
	'reward.toggleManual': toggleManualReward
} satisfies Record<SyncOperation['type'], (formData: FormData) => Promise<void>>;

function payloadToFormData(payload: SyncOperation['payload']) {
	const formData = new FormData();
	for (const [key, value] of Object.entries(payload)) {
		formData.set(key, value);
	}
	return formData;
}

function isSyncOperation(value: unknown): value is SyncOperation {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<SyncOperation>;
	return (
		typeof candidate.id === 'string' &&
		candidate.id.length > 0 &&
		typeof candidate.type === 'string' &&
		candidate.type in operationHandlers &&
		typeof candidate.createdAt === 'string' &&
		!!candidate.payload &&
		typeof candidate.payload === 'object' &&
		Object.values(candidate.payload).every((field) => typeof field === 'string')
	);
}

export async function applySyncOperations(operations: unknown[]) {
	const db = getDb();
	const applied: string[] = [];
	const skipped: string[] = [];

	for (const operation of operations) {
		if (!isSyncOperation(operation)) {
			throw new Error('Invalid sync operation.');
		}

		const existing = db
			.select({ id: syncOperations.id })
			.from(syncOperations)
			.where(eq(syncOperations.id, operation.id))
			.get();

		if (existing) {
			skipped.push(operation.id);
			continue;
		}

		await operationHandlers[operation.type](payloadToFormData(operation.payload));
		db.insert(syncOperations)
			.values({
				id: operation.id,
				type: operation.type,
				createdAt: operation.createdAt,
				appliedAt: new Date().toISOString()
			})
			.run();
		applied.push(operation.id);
	}

	return {
		applied,
		skipped,
		summary: getDashboardSummary()
	};
}
