<script lang="ts">
	let {
		disabled = false,
		loading = false,
		onsubmit
	}: { disabled?: boolean; loading?: boolean; onsubmit: () => void } = $props();
</script>

<button type="button" disabled={disabled || loading} onclick={onsubmit}
	>{loading ? 'Finding route…' : 'Find Route'}</button
>

<style>
	button {
		width: 100%;
		padding: 13px 16px;
		border: 0;
		border-radius: 10px;
		background: #f47721;
		color: #171717;
		font: inherit;
		font-weight: 750;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
