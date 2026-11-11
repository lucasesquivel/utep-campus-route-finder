<script lang="ts">
import CampusMap from '../lib/ui/components/CampusMap.svelte';
import BuildingSelector from '../lib/ui/components/BuildingSelector.svelte';
import RoutingModeSelector from '../lib/ui/components/RoutingModeSelector.svelte';
import RouteControls from '../lib/ui/components/RouteControls.svelte';
import RouteFeedback from '../lib/ui/components/RouteFeedback.svelte';
import { HttpRouteService } from '../lib/ui/RouteService';
import { NoRouteError, type Building, type RouteMode, type RouteResult } from '../lib/ui/types';

  // No routes are invented; requests go exclusively to the Controller interface. Need campus data
  const buildings: Building[] = [
    { id: 'library', name: 'UTEP Library (sample)', coordinates: [-106.5047, 31.7720] },
    { id: 'union', name: 'Union Building (sample)', coordinates: [-106.5060, 31.7709] },
    { id: 'engineering', name: 'Engineering Building (sample)', coordinates: [-106.5026, 31.7704] }
  ];
  const routeService = new HttpRouteService('/api/route');

  let startBuildingId = $state('');
  let destinationBuildingId = $state('');
  let mode = $state<RouteMode>('shortest');
  let route = $state<RouteResult | null>(null);
  let error = $state('');
  let loading = $state(false);
  let currentRequest: AbortController | undefined;

  const valid = $derived(Boolean(startBuildingId && destinationBuildingId && startBuildingId !== destinationBuildingId));

  function resetRoute() {
    currentRequest?.abort();
    loading = false;
    route = null;
    error = '';
  }

  // Clear old route when the chosen inputs change.
  $effect(() => {
    startBuildingId; destinationBuildingId; mode;
    resetRoute();
  });

  async function submitRoute() {
    if (!valid) {
      error = 'Choose two different buildings.';
      return;
    }
    currentRequest?.abort();
    const controller = new AbortController();
    currentRequest = controller;
    loading = true;
    route = null;
    error = '';
    try {
      const result = await routeService.getRoute({ startBuildingId, destinationBuildingId, mode }, controller.signal);
      if (!controller.signal.aborted) route = result;
    } catch (cause) {
      if (!controller.signal.aborted) {
        error = cause instanceof NoRouteError ? cause.message :
          cause instanceof Error ? cause.message : 'The route could not be loaded.';
      }
    } finally {
      if (currentRequest === controller) loading = false;
    }
  }
</script>

<svelte:head><title>UTEP Campus Route Finder</title><meta name="description" content="Explore the UTEP campus and select a walking route." /></svelte:head>
<div class="site">
  <header><div class="brand"><span class="logo">UTEP</span><div><h1>Campus Route Finder</h1><p>Find your way around campus</p></div></div></header>
  <main>
    <section class="panel" aria-label="Route planning controls">
      <h2>Plan your walk</h2>
      <div class="field"><BuildingSelector id="start-building" label="Starting building" {buildings} bind:value={startBuildingId} /></div>
      <div class="field"><BuildingSelector id="destination-building" label="Destination building" {buildings} bind:value={destinationBuildingId} /></div>
      <div class="field"><RoutingModeSelector bind:value={mode} /></div>
      {#if startBuildingId && destinationBuildingId && startBuildingId === destinationBuildingId}
        <p class="validation" role="alert">Choose two different buildings.</p>
      {/if}
      <RouteControls disabled={!valid} {loading} onsubmit={submitRoute} />
      <RouteFeedback {route} {error} {loading} />
      <p class="notice">Building markers and coordinates are sample placeholders, not verified campus data. Route calculation requires the team's Controller API.</p>
    </section>
    <section class="map-panel" aria-label="Campus map"><CampusMap {buildings} {route} /></section>
  </main>
</div>
<style>
  :global(body) { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: #f5f7fa; color: #1b2938; }
  :global(*) { box-sizing: border-box; }
  header { background: #092f57; padding: 18px max(22px, calc((100vw - 1300px) / 2)); color: white; }
  .brand { display: flex; gap: 14px; align-items: center; }
  .logo { background: #f47721; color: #102b44; padding: 12px 10px; font-weight: 900; border-radius: 10px; }
  h1 { font-size: 1.42rem; line-height: 1.15; margin: 0; }
  header p { margin: 5px 0 0; color: #dce8f4; font-size: .9rem; }
  main { max-width: 1344px; margin: auto; display: grid; grid-template-columns: 355px minmax(0, 1fr); gap: 22px; padding: 24px; }
  .panel { background: white; border-radius: 16px; padding: 22px; box-shadow: 0 3px 24px #1829420d; align-self: start; }
  .panel h2 { margin: 0 0 20px; font-size: 1.25rem; }
  .field { margin-bottom: 19px; }
  .notice { margin-top: 20px; padding-top: 14px; border-top: 1px solid #e2e7ed; font-size: .77rem; color: #657181; line-height: 1.5; }
  .validation { font-size: .86rem; color: #a32216; }
  .map-panel { min-width: 0; }
  @media (max-width: 800px) { main { display: flex; flex-direction: column; padding: 14px; gap: 14px; } .panel { width: 100%; } }
</style>
