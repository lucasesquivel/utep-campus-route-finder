<script lang="ts">
	import { onMount } from 'svelte';
	import { MapLibreRenderer } from '../MapLibreRenderer';
	import type { Building, RouteResult } from '../types';
	import 'maplibre-gl/dist/maplibre-gl.css';

	let { buildings, route }: { buildings: Building[]; route: RouteResult | null } = $props();
	let container: HTMLDivElement;
	let renderer: MapLibreRenderer | undefined;
	let mapError = $state('');

	onMount(() => {
		try {
			renderer = new MapLibreRenderer(container);
			renderer.setBuildings(buildings);
			renderer.setRoute(route);
			renderer.map.on('error', () => {
				mapError = 'Some map tiles could not be loaded. Check your internet connection.';
			});
		} catch {
			mapError = 'Map initialization failed. Please refresh the page.';
		}
		return () => renderer?.destroy();
	});

	$effect(() => {
		renderer?.setBuildings(buildings);
	});
	$effect(() => {
		renderer?.setRoute(route);
	});
</script>

<div class="map-shell">
	<div bind:this={container} class="map" aria-label="Interactive UTEP campus map"></div>
	{#if mapError}<div class="map-error" role="alert">{mapError}</div>{/if}
</div>

<style>
	.map-shell {
		position: relative;
		min-height: 410px;
		width: 100%;
		border-radius: 16px;
		overflow: hidden;
		border: 1px solid #dedede;
	}
	.map {
		height: min(68vh, 700px);
		min-height: 410px;
		width: 100%;
	}
	.map-error {
		position: absolute;
		bottom: 25px;
		left: 12px;
		right: 12px;
		background: #fff4e7;
		color: #7c3100;
		padding: 10px;
		border-radius: 8px;
		font-size: 0.9rem;
	}
	:global(.campus-marker) {
		border: 2px solid white;
		background: #073a71;
		color: white;
		border-radius: 50%;
		width: 28px;
		height: 28px;
		cursor: pointer;
		box-shadow: 0 2px 8px #0006;
		font-size: 18px;
	}
</style>
