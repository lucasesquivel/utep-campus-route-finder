# sv & bun

Everything you need to develop & build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli), Using [`Bun`](https://bun.com/)

## Adding features

Add features to the project with `bun add`:

```sh
bun add
```

For example, to add the map library:

```sh
bun add maplibre-gl
```

## Developing

Once you've created a project and installed dependencies with `bun install`, start a development server:

```sh
bun run dev

# or start the server and open the app in a new browser tab (Recommended)
bun run dev -- --open
```

## Building

To create a production version of your app:

```sh
bun run build
```

You can preview the production build with `bun run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

 
 
### Project File Structure
## Project Structure

Source code is organized by the four subsystems defined in the SDD. Routing logic must stay out of Svelte components, and MapLibre is used only for visualization.

```
src/
  routes/
    +page.svelte                  # RouteFinderPage (top-level UI coordinator)
  lib/
    ui/                           # UI / Map subsystem
      components/****
        CampusMap.svelte
        BuildingSelector.svelte
        RoutingModeSelector.svelte
        RouteControls.svelte
        RouteFeedback.svelte
      RouteService.ts
      MapRenderer.ts              # interface
      MapLibreRenderer.ts
      types.ts
    controller/                   # Application / Controller subsystem
      RouteController.ts
      types.ts
    routing/                      # Routing subsystem
      RouteEngine.ts
      RoutingStrategy.ts          # interface
      ShortestRouteStrategy.ts
      EasyRouteStrategy.ts
      AdaRouteStrategy.ts
      Route.ts
      MinPriorityQueue.ts
      types.ts
      errors.ts
    campusdata/                   # Campus Data subsystem
      CampusRepository.ts
      CampusGraph.ts
      CampusDataSource.ts         # interface
      StaticFileCampusDataSource.ts
      types.ts
      errors.ts
    shared/                       # Used by more than one subsystem
      types.ts                    # RouteMode, LngLat
      haversine.ts
static/
  data/                           # OSM-derived campus data
```

### Subsystem Responsibilities

| Folder | Subsystem | Owns |
| --- | --- | --- |
| `ui/` | UI / Map | User input, map rendering, displaying routes and errors |
| `controller/` | Application / Controller | Validating requests, coordinating Routing and Campus Data |
| `routing/` | Routing | Route search, edge traversability and cost, route results |
| `campusdata/` | Campus Data | CampusGraph, buildings, entrances, path facts (no costs) |

### Conventions

- Classes and interfaces use PascalCase filenames that match the entity (`RouteEngine.ts`). Svelte components also use PascalCase (`BuildingSelector.svelte`).
- Tests live next to the code they test as `*.test.ts` (Vitest).
- Data flow: Campus data → `CampusGraph` → `RouteEngine` → `Route` → MapLibre display.