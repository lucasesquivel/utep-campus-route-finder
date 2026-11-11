<script lang="ts">
  import type { RouteResult } from '../types';
  let { route, error, loading }: { route: RouteResult | null; error: string; loading: boolean } = $props();
</script>
<section aria-live="polite">
  {#if error}
    <p class="error" role="alert">{error}</p>
  {:else if loading}
    <p>Calculating your requested route…</p>
  {:else if route}
    <h2>Your route</h2>
    {#if route.distanceMeters !== undefined}<p>Distance: {(route.distanceMeters / 1000).toFixed(2)} km</p>{/if}
    {#if route.estimatedMinutes !== undefined}<p>Estimated walking time: {Math.round(route.estimatedMinutes)} minutes</p>{/if}
    {#if route.instructions?.length}
      <ol>{#each route.instructions as instruction}<li>{instruction}</li>{/each}</ol>
    {/if}
  {:else}
    <p>Select two buildings and a mode to find a walking route.</p>
  {/if}
</section>
<style>
  section { color: #404854; padding-top: 8px; }
  h2 { color: #0d2c50; font-size: 1.05rem; margin: 2px 0 8px; }
  p { margin: 6px 0; }
  .error { padding: 12px; color: #842218; background: #fff0ed; border-radius: 9px; }
</style>
