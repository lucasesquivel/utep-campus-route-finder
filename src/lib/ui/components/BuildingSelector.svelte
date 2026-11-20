<script lang="ts">
	import type { Building } from '../types';
	let {
		id,
		label,
		buildings,
		value = $bindable(''),
		disabled = false
	}: {
		id: string;
		label: string;
		buildings: Building[];
		value: string;
		disabled?: boolean;
	} = $props();
</script>

<label for={id}>{label}</label>
<select {id} bind:value {disabled}>
	<option value="">Select a building</option>
	{#each buildings as building (building.id)}
		<option value={building.id}>{building.name}</option>
	{/each}
</select>

<style>
	label {
		display: block;
		font-weight: 650;
		margin-bottom: 6px;
	}
	select {
		display: block;
		width: 100%;
		padding: 11px;
		border: 1px solid #c4cbd5;
		border-radius: 9px;
		background: white;
		font: inherit;
	}
</style>
