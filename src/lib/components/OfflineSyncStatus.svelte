<script lang="ts">
	import { onMount } from 'svelte';
	import type { SyncOperation } from '$lib/types';
	import {
		announceOfflineSync,
		createOperation,
		outboxCount,
		submitOrQueue,
		syncPendingOperations,
		warmOfflineCache,
		type OfflineSyncStatus
	} from '$lib/client/offline-sync';

	let status = $state<OfflineSyncStatus>({
		online: true,
		pendingCount: 0,
		syncing: false,
		message: 'Online'
	});

	function setStatus(next: Partial<OfflineSyncStatus>) {
		status = { ...status, ...next };
		announceOfflineSync(status);
	}

	async function refreshPending() {
		setStatus({
			online: navigator.onLine,
			pendingCount: await outboxCount(),
			message: navigator.onLine ? 'Online' : 'Offline mode'
		});
	}

	async function syncQueued({ reloadOnChange = false } = {}) {
		if (!navigator.onLine || status.syncing) return;
		setStatus({ syncing: true, message: 'Syncing changes...' });
		try {
			const result = await syncPendingOperations();
			setStatus({
				syncing: false,
				pendingCount: result.pending,
				message: result.pending ? `${result.pending} changes waiting` : 'All changes synced'
			});
			if (reloadOnChange && result.synced > 0) {
				window.location.reload();
			} else {
				warmOfflineCache();
			}
		} catch (error) {
			console.warn('ink.ly background sync failed.', error);
			setStatus({
				syncing: false,
				pendingCount: await outboxCount(),
				message: error instanceof Error ? `Sync paused: ${error.message}` : 'Sync paused. Changes are safe locally.'
			});
		}
	}

	async function handleSubmit(event: SubmitEvent) {
		const form = event.target instanceof HTMLFormElement ? event.target : null;
		const type = form?.dataset.offlineMutation as SyncOperation['type'] | undefined;
		if (!form || !type) return;

		event.preventDefault();
		const submitter = event.submitter instanceof HTMLElement ? event.submitter : null;
		submitter?.setAttribute('disabled', 'true');
		setStatus({ syncing: navigator.onLine, message: navigator.onLine ? 'Saving...' : 'Saving offline...' });

		try {
			const result = await submitOrQueue(createOperation(type, new FormData(form)));
			setStatus({
				syncing: false,
				pendingCount: result.pending,
				message: result.queued ? `${result.pending} changes waiting to sync` : 'Saved'
			});
			if (!result.queued) {
				window.location.reload();
			}
		} catch (error) {
			console.warn('ink.ly form sync failed.', error);
			setStatus({
				syncing: false,
				pendingCount: await outboxCount(),
				message: error instanceof Error ? `Sync error: ${error.message}` : 'Sync error. Changes are safe locally.'
			});
		} finally {
			submitter?.removeAttribute('disabled');
		}
	}

	onMount(() => {
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.register('/offline-service-worker.js');
		}

		refreshPending();
		syncQueued({ reloadOnChange: true });
		warmOfflineCache();

		const handleOnline = () => {
			setStatus({ online: true, message: 'Back online. Syncing...' });
			syncQueued({ reloadOnChange: true });
		};
		const handleOffline = () => setStatus({ online: false, message: 'Offline mode' });
		const handleStatus = (event: Event) => {
			status = (event as CustomEvent<OfflineSyncStatus>).detail;
		};

		document.addEventListener('submit', handleSubmit, true);
		window.addEventListener('online', handleOnline);
		window.addEventListener('offline', handleOffline);
		window.addEventListener('inkly-offline-sync', handleStatus);

		return () => {
			document.removeEventListener('submit', handleSubmit, true);
			window.removeEventListener('online', handleOnline);
			window.removeEventListener('offline', handleOffline);
			window.removeEventListener('inkly-offline-sync', handleStatus);
		};
	});
</script>

<div class={`offline-status ${status.online ? 'online' : 'offline'}`} aria-live="polite">
	<span>{status.message}</span>
	{#if status.pendingCount > 0}
		<span>{status.pendingCount} pending</span>
	{/if}
	{#if status.syncing}
		<span>Syncing</span>
	{/if}
</div>
