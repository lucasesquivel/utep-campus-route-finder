<script lang="ts">
	import type { RouteMode } from '../types';
	let {
		value = $bindable('shortest'),
		disabled = false
	}: { value: RouteMode; disabled?: boolean } = $props();
	const options: { value: RouteMode; label: string }[] = [
		{ value: 'shortest', label: 'Shortest' },
		{ value: 'easy', label: 'Easy' },
		{ value: 'ada', label: 'ADA Accessible' }
	];
</script>

<fieldset {disabled}>
	<legend>Route preference</legend>
	<div class="options">
		{#each options as option (option.value)}
			<label class:selected={value === option.value}>
				<input type="radio" name="route-mode" value={option.value} bind:group={value} />
				{option.label}
			</label>
		{/each}
	</div>
</fieldset>

<style>
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
	}
	legend {
		font-weight: 650;
		margin-bottom: 8px;
	}
	.options {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	label {
		padding: 9px 12px;
		border: 1px solid #c5cbd5;
		border-radius: 100px;
		cursor: pointer;
		font-size: 0.92rem;
	}
	label.selected {
		background: #073a71;
		border-color: #073a71;
		color: white;
	}
	input {
		accent-color: #ef7e23;
	}
</style>
