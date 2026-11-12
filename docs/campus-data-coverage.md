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
| Corrections | `static/data/campus-corrections.json` (empty so far; see below)                          |
| License     | ODbL. Credit "© OpenStreetMap contributors" wherever the data is shown                   |

Load it with:

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
2. **No elevation or slope.** No node has an `ele` tag, and the 16 `incline` tags say only "up"
   or "down", not a grade. Easy and ADA therefore cannot penalize steep slopes on real data. A
   digital elevation model could be plugged in through the transformer's `elevationLookup`
   option.
3. **Most buildings have no mapped entrance.** 44 of 51 named buildings have none, including
   Bell Hall, Undergraduate Learning Center, Union Complex, Engineering and Sciences Complex,
   Chemistry and Computer Science, and Fox Fine Arts Center. They stay selectable; the
   Controller reports a missing-entrance failure for them.
4. **Disconnected fragments.** 11 small components (311 nodes in total, the largest 147 nodes)
   are not connected to the main network. None holds a mapped entrance today, but routes that
   start or end inside one will fail as unreachable.
5. **Off-campus buildings in the area.** The map view includes neighbors such as McDonald's,
   Hilton Garden Inn, Providence Memorial Hospital and Mesa Hills Healthcare Residence. They are
   kept as named buildings; the UI may want to filter them.
6. **No step counts.** Stairs have no `step_count`, so Easy uses its default per-flight penalty.

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
