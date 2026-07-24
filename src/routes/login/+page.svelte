<script lang="ts">
	let {
		data,
		form
	}: {
		data: { next: string };
		form?: { message?: string; next?: string };
	} = $props();
</script>

<section class="stack" style="max-width: 42rem; margin: 4rem auto;">
	<section class="card" style="padding: 1.5rem;">
		<div class="section-title">
			<h1 class="display" style="margin: 0;">ink.ly</h1>
		</div>

		<form method="POST" action="?/login" class="stack">
			<input type="hidden" name="next" value={form?.next ?? data.next} />
			<label>
				<span class="eyebrow">Access token</span>
				<input name="token" type="password" autocomplete="current-password" required />
			</label>
			{#if form?.message}
				<div class="empty-state">{form.message}</div>
			{/if}
			<div class="button-row" style="justify-content: flex-end;">
				<button class="button primary" type="submit">Unlock</button>
			</div>
		</form>
	</section>
</section>
