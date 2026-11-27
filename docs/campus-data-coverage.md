# Campus Data: real UTEP coverage and data gaps

This document records what the Campus Data subsystem can and cannot represent from the real
UTEP OpenStreetMap (OSM) export. It is a snapshot; regenerate the numbers after refreshing the
export. The automated checks for these facts are in
`src/lib/campusdata/CampusRealData.test.ts`.

## Source

| Item        | Value                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------- |
| File        | `static/data/campus-osm.json` (raw Overpass JSON, unmodified)                            |
| Downloaded  | Overpass API, OSM data as of 2026-11-10                                                  |
| Area        | Map view around campus: lat 31.7621 to 31.7771, lng -106.5105 to -106.4918               |
| Query       | `way["highway"]`, `way["building"]` and `node["entrance"]` in the view, with their nodes |
| Corrections | `static/data/campus-corrections.json` (2 candidate entrances; see below)                 |
| License     | ODbL. Credit "© OpenStreetMap contributors" wherever the data is shown                   |

The app loads it in `src/lib/server/campus.ts` (`DiskOsmCampusDataSource`) with inferred
entrances at 45 m, the DEM elevations from `static/data/campus-elevation.json`, and the
corrections file. `OsmCampusDataSource` applies the same corrections, and it is what
`CampusRealData.test.ts` uses:

```ts
new CampusRepository(
	new OsmCampusDataSource('/data/campus-osm.json', {}, fetch, '/data/campus-corrections.json')
);
```

## What the pipeline produces

| Measure                                     | Value                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| Walkable OSM path types                     | footway, path, steps, pedestrian, corridor, cycleway, living_street, service |
| Walkable ways / graph nodes / path segments | 746 / 3,010 / 3,296 (each walkable both ways)                                |
| Walkable network length                     | about 40.5 km of path segments                                               |
| Stair segments (always `inaccessible`)      | 109                                                                          |
| Ramp segments                               | 19                                                                           |
| Named buildings kept                        | 51 (54 unnamed building outlines are not selectable and are dropped)         |
| Mapped entrances                            | 12, on 7 buildings, all directly on the path network                         |
| Connected components                        | 12; the main network has 2,699 of 3,010 nodes                                |

Connectivity follows OSM exactly: paths join only where their ways share a node. Nothing is
joined by proximity. Adding `service` lanes to the walkable types raised the main network from
2,042 to 2,699 nodes and connected all mapped entrances to it.

## Representative routes (RouteEngine, real data)

| From                    | To                          | Shortest                | Easy                   | ADA              |
| ----------------------- | --------------------------- | ----------------------- | ---------------------- | ---------------- |
| Old Main                | University Library          | 577 m, 1 stair segment  | 577 m, 1 stair segment | 685 m, no stairs |
| Old Main                | Psychology                  | 122 m, 2 stair segments | 151 m, 1 stair segment | 241 m, no stairs |
| Sun Bowl Parking Garage | Old Main                    | 396 m, 5 stair segments | 418 m, 1 stair segment | 526 m, no stairs |
| Psychology              | Health Sciences and Nursing | 529 m, 2 stair segments | 576 m, no stairs       | 576 m, no stairs |
| Quinn Hall              | University Library          | 538 m, no stairs        | 538 m                  | 538 m            |
| Lhakhang                | University Library          | 442 m, no stairs        | 442 m                  | 442 m            |

Each mode behaves as designed: Shortest uses stairs freely, Easy reduces them, and ADA never
uses them. Almost all of every route is reported as unverified accessibility (see gaps).

Buildings with a mapped entrance: Old Main, University Library, Psychology (4 entrances), Quinn
Hall, Health Sciences and Nursing (2), Sun Bowl Parking Garage (2), and Lhakhang.

## Data gaps

1. **No accessibility information on paths.** None of the walkable ways has a `wheelchair` tag,
   so every non-stair path is `unknown`. ADA routes avoid stairs but are otherwise unverified,
   and `Route.unverifiedAccessibilityDistanceM` is close to the whole route length. The UI must
   show the unverified-route warning.
2. **Slopes not yet validated.** OSM has no `ele` tags, and its 16 `incline` tags say only "up"
   or "down". Every network node now has an elevation from the USGS 1 m DEM (see
   `docs/elevation-dataset.md`), but DEM-derived slopes stay switched off until they are
   validated, so Easy and ADA do not yet penalize steep slopes on real data.
3. **Most buildings have no mapped entrance.** 44 of 51 named buildings have none, including
   Bell Hall, Undergraduate Learning Center, Union Complex, Engineering and Sciences Complex,
   Chemistry and Computer Science, and Fox Fine Arts Center. The app currently gives them
   inferred entrances (45 m), which are unverified approximations, not real doors.
4. **Disconnected fragments.** 11 small components (311 nodes in total, the largest 147 nodes)
   are not connected to the main network. None holds a mapped entrance today, but routes that
   start or end inside one will fail as unreachable.
5. **Buildings outside the supported scope.** The map view includes neighbors such as McDonald's,
   Hilton Garden Inn, Providence Memorial Hospital and Mesa Hills Healthcare Residence, and
   distant facilities such as Larry K. Durham Sports Center (which is also on a path fragment
   disconnected from campus). The supported scope is the inner-campus polygon in
   `static/data/campus-boundary.json`: the convex hull of the 45 supported buildings' footprints,
   expanded by 30 m. `BuildingCatalog` offers only buildings whose centroid is inside it, while
   Campus Data keeps the others as facts. Memorial Gym and Holliday Hall are inside the scope.
   `src/lib/integration/CampusScope.integration.test.ts` checks that every offered building is
   inside the boundary and can be reached from the University Library in all three modes.
6. **No step counts.** Stairs have no `step_count`, so Easy uses its default per-flight penalty.

## Entrance corrections

| Building                             | Problem                                         | Correction                                       |
| ------------------------------------ | ----------------------------------------------- | ------------------------------------------------ |
| Mike Loya Academic Services Building | Inferred entrance reachable only by stairs; ADA | Entrance at stair-free path point `n13784099370` |
|                                      | routes returned NO_ROUTE                        | (about 25 m from the building center)            |
| Union West                           | Inferred entrance reachable only by stairs; ADA | Entrance at stair-free path point `n9802146258`  |
|                                      | routes returned NO_ROUTE                        | (about 17 m from the building center)            |

Both are candidates from the 2026-11-26 data audit and must be confirmed on site; their notes
in the corrections file say so until then. Routes to Business Administration, Hertzog Building,
Schuster Parking Garage and Advanced Manufacturing and Aerospace are 2 to 3 times the
straight-line distance, which suggests their inferred entrances are on the wrong side; check
those doors next.

## How to close the gaps

- **Verified corrections:** record entrances, missing connections and observed accessibility in
  `static/data/campus-corrections.json`, never in the OSM export. Every correction needs a
  `note` saying how it was verified (site visit, photo, campus accessibility map).
- **Inferred entrances (opt-in, unverified):** setting `fallbackEntranceDistanceM` links a
  building without an entrance to its nearest path node. On this export, 30 m covers 45 of 51
  buildings and 50 m covers 49. Inferred entrances are always `unknown` and marked `inferred`,
  so they are suitable for demos but not for accessibility claims.
- **Upstream fixes:** adding `entrance` and `wheelchair` tags in OpenStreetMap itself improves
  every future export.
