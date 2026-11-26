# Elevation data: USGS 1 m DEM for the campus path network

This document describes the elevation dataset, how it is preprocessed into the small file the
app loads, and which slope measurements are not reliable yet.

## Source dataset

| Item              | Value                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product           | USGS 3D Elevation Program (3DEP) one-meter DEM                                                                                                               |
| Project           | TX_RioGrand_FTWhit_2014                                                                                                                                      |
| Tile              | `USGS_one_meter_x35y352_TX_RioGrand_FTWhit_2014.tif` (one 10 km x 10 km tile covers all of campus)                                                           |
| Download          | `https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/TX_RioGrand_FTWhit_2014/TIFF/USGS_one_meter_x35y352_TX_RioGrand_FTWhit_2014.tif`      |
| Metadata          | Same path with `metadata/` and `_meta.xml` in place of `TIFF/` and `.tif`                                                                                    |
| Size / SHA-256    | 155 MB / `db99bc834b1a524ed0d12a888606753eadfd7097d7d71ccfbe64bb87ab46d35b`                                                                                  |
| Lidar collected   | 2014-11-30 to 2014-12-11 (published 2020-03-30)                                                                                                              |
| Coordinate system | EPSG:26913, NAD83 / UTM zone 13N, 1 m pixels, 10,012 x 10,012                                                                                                |
| Extent            | Easting 349,994 to 360,006 m; northing 3,509,994 to 3,520,006 m                                                                                              |
| Surface           | Bare earth: buildings, bridges and other structures are removed                                                                                              |
| Elevations        | Meters, NAVD88 vertical datum, 32-bit float                                                                                                                  |
| Vertical accuracy | Not stated in the tile metadata. We assume 0.10 m RMSE, the USGS lidar Quality Level 2 requirement for one-meter DEMs; confirm before relying on fine slopes |
| Terms             | USGS data, no warranty; acknowledge the USGS when using derived products                                                                                     |

The GeoTIFF is **not** committed to the repository. Only the preprocessed file is.

## Preprocessing

```bash
curl -O https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/TX_RioGrand_FTWhit_2014/TIFF/USGS_one_meter_x35y352_TX_RioGrand_FTWhit_2014.tif
bun run preprocess:dem --dem USGS_one_meter_x35y352_TX_RioGrand_FTWhit_2014.tif
```

`scripts/preprocess-dem.ts`:

1. Runs `static/data/campus-osm.json` through the same `OsmCampusTransformer` the app uses, so it
   samples exactly the path-network nodes and segments.
2. Projects each node from OSM coordinates (WGS84) to UTM zone 13N with `proj4`, and reads only
   the DEM window covering the network.
3. Samples each node's elevation by bilinear interpolation of the four nearest pixels.
4. Checks every segment for the slope issues below.
5. Writes `static/data/campus-elevation.json` (144 KB): elevations by OSM node id, issues by
   segment id, and the provenance above. The run takes about one second and is reproducible.

The file is tied to the OSM export it was sampled for. **Rerun the script whenever
`campus-osm.json` is refreshed.**

## Results

| Measure                                               | Value                                                    |
| ----------------------------------------------------- | -------------------------------------------------------- |
| Network nodes with an elevation                       | 3,010 of 3,010                                           |
| Elevation range                                       | 1,144.83 m to 1,206.22 m (61 m across campus)            |
| Path segments                                         | 3,296, of which 109 are stairs                           |
| Segments with at least one slope issue                | 2,050                                                    |
| Reliable non-stair segments                           | 1,234                                                    |
| Reliable non-stair grade (absolute)                   | median 2.0%, 90th percentile 6.4%, 99th percentile 11.5% |
| Reliable segments steeper than 8.33% (ADA ramp limit) | 51                                                       |

## Unreliable slope measurements

A segment's slope is its elevation change divided by its length. It is flagged when the DEM
cannot support that number:

| Issue                    | Rule                                                                                          | Segments | Why it is unreliable                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `short-segment`          | Shorter than 7.1 m                                                                            | 1,731    | With 0.10 m vertical error at each end, the grade error exceeds 2%                                  |
| `terrain-discontinuity`  | Over 1.0 m height range in the 3 x 3 pixels around an endpoint                                | 279      | A wall, curb, ramp edge or building edge makes the interpolated height depend on sub-meter position |
| `structure`              | OSM `bridge`, `tunnel`, `covered=yes`, `indoor=yes`, `highway=corridor` or a non-zero `layer` | 174      | The bare-earth DEM is the ground under or over the path, not its walking surface                    |
| `irregular-profile`      | Ground between the endpoints departs over 0.5 m from a straight incline                       | 173      | The segment crosses a dip or rise, so endpoint grade misstates it                                   |
| `steep-needs-validation` | Non-stair grade steeper than 15%                                                              | 130      | Unusual for a walkway; needs a field check                                                          |
| `missing-elevation`      | An endpoint has no DEM value                                                                  | 0        |                                                                                                     |

A segment can have several issues; the counts overlap.

### The unusually steep slopes

Of the 130 steep non-stair segments, 120 also have another issue that explains them. The worst
are footbridges, where the DEM measures the ground below the deck: for example `w1501274253:0`
computes to -73% and `w1067662975:0` to +53%.

The other 10 have no other explanation and should be checked on site:

| Segment         | Grade  | Length | Type               | Location (lat, lng)  |
| --------------- | ------ | ------ | ------------------ | -------------------- |
| `w1067662994:1` | -24.0% | 8.8 m  | footway            | 31.77124, -106.50353 |
| `w1507378997:1` | -22.1% | 11.7 m | footway            | 31.76695, -106.50571 |
| `w1499793872:1` | +20.8% | 22.1 m | footway            | 31.77232, -106.50823 |
| `w962788294:13` | -18.8% | 9.2 m  | footway            | 31.77479, -106.50312 |
| `w1501239940:4` | -18.7% | 7.3 m  | footway            | 31.76956, -106.50719 |
| `w1501250880:6` | -16.8% | 10.4 m | footway            | 31.76848, -106.50126 |
| `w1067662966:4` | -16.6% | 9.8 m  | footway            | 31.76746, -106.50656 |
| `w1092883948:0` | +16.5% | 12.7 m | service (driveway) | 31.77585, -106.50269 |
| `w1501250881:0` | +16.4% | 18.1 m | footway            | 31.76834, -106.50206 |
| `w1495744137:4` | -15.9% | 8.3 m  | path               | 31.77236, -106.50740 |

Locations are the segment's start node. Grades are in the segment's stored direction.

### Stairs

Stairs are always `inaccessible` and are penalized by stair rules, not slope, so their grades
are not used. Their median segment grade is 19.7%. 12 stair segments compute to under 5%, which
suggests mislocated stairs or a stair segment that includes a flat landing; worth checking in
OSM.

## Integration status

- `ElevationDataset` (`src/lib/campusdata/ElevationDataset.ts`) loads the file and validates it.
- The app (`src/lib/server/campus.ts`) attaches the elevations to graph nodes with
  `transformOptions(false)`. **No slope reaches Routing**, so Easiest and ADA routing are
  unchanged. Route summaries now report elevation gain and loss.
- Gain and loss on routes over footbridges are overstated, because nodes on a bridge get the
  ground elevation beneath it. The net change between the route's ends is unaffected.

## Before enabling slope-aware routing

1. Field-check the 10 segments above and a sample of reliable segments steeper than 8.33%.
2. Confirm the dataset's vertical accuracy, or measure it against a few surveyed points.
3. Decide how to treat short segments. They lose their slope today; a grade averaged over a
   longer stretch of the same path would keep the information without the noise.
4. Then switch to `transformOptions(true)`, which derives slopes only for reliable segments,
   and update the routing tests.

## Known limitations

- The lidar is from 2014; paths, ramps or grading built since then are not reflected.
- OSM coordinates are WGS84 and the DEM is NAD83. They differ by about 1 m here; the script
  does not shift between them, which mainly affects `terrain-discontinuity` checks near edges.
- Paths added through the corrections file have no DEM elevation until the script is extended
  to sample them.
