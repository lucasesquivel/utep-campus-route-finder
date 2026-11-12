# Test Results Summary

Branch: `jason` | Code under test: `194f616` (Controller merged) | Run date: 2026-11-11
Environment: Linux VM, Bun 1.4.4, dependencies from `bun.lock`.
Raw output of every command is in this folder: `check.txt`, `lint.txt`, `eslint.txt`, `test.txt`, `build.txt`, `coverage.txt`.
The files ending in `-mac.txt` are the same commands run on a MacBook **before the Controller was merged**: same results then (287 tests passed).

| Command                            | Result   | Details                                                                                                  |
| ---------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `bun run check` (svelte-check)     | PASS     | 0 errors, 0 warnings                                                                                     |
| `bun run lint` (prettier + eslint) | **FAIL** | Prettier: 13 source files not formatted (11 UI/page files + 2 Controller files). ESLint is never reached |
| `bunx eslint .` (run on its own)   | **FAIL** | 12 errors in 4 files (8 in the Controller, 4 in UI/page files)                                           |
| `bun run test` (vitest)            | PASS     | 19 files: 320 passed + 10 known issues (marked "expected fail") = 330                                    |
| `bun run build`                    | PASS     | Built. Warning: some chunks are larger than 500 kB                                                       |

All test files written for testing pass Prettier, ESLint and svelte-check.

## Known issues found by testing (10 checks, recorded in `ControllerAndApp.knownIssues.test.ts`)

Each is a test of how the program should behave. Today it does not, so Vitest lists it as "expected fail". When the issue is fixed, the test starts failing with "Expect test to fail", and `it.fails` should be changed to `it`.

| #   | Issue                                                                                                                                                                                                                                                      | Effect                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | `findNearestNode` calls `graph.nodes()`, but `nodes` is a Map in `CampusGraph` (it has `getNodes()`): `TypeError: graph.nodes is not a function`                                                                                                           | Every `mapPoint` start/destination fails with `UNEXPECTED_ERROR` (2 checks) |
| 2   | `validateRouteRequest` (public, AC-2) throws `DataLoadError` if called before the data is loaded                                                                                                                                                           | Returns an exception instead of a validation result                         |
| 3   | `processRouteRequest` calls `loadCampusData()` on every request                                                                                                                                                                                            | Full data download, parse and validation per click                          |
| 4   | The `RouteEngine` is created once from the first load and keeps that graph; later loads replace the repository data but not the engine's graph                                                                                                             | Routes can be calculated on out-of-date data                                |
| 5   | `handleRouteFailure` treats any error whose message contains "load" as `DATA_NOT_READY`                                                                                                                                                                    | e.g. "failed to download" is reported as a data problem                     |
| 6   | Controller sends `totalDistanceM` / `estimatedWalkTimeS`; UI reads `distanceMeters` / `estimatedMinutes`                                                                                                                                                   | Line can be drawn, distance and time would be missing (2 checks)            |
| 7   | No `/api/route` endpoint exists (`src/routes/api/route/+server.ts`); `+page.svelte` posts to it                                                                                                                                                            | Every click ends in HTTP 404                                                |
| 8   | `+page.svelte` offers sample building ids `library`, `union`, `engineering`; campus data uses `b_library`, `b_union`, `b_eng` (and `RouteService` sends `startBuildingId`/`destinationBuildingId`, the Controller expects `{ origin, destination, mode }`) | Selections from the page could not be matched to buildings                  |

## Lint findings (not changed by testing)

Prettier (fix with `bun run format`): the 5 components in `src/lib/ui/components/`, `src/lib/ui/MapLibreRenderer.ts`, `MapRenderer.ts`, `RouteService.ts`, `RouteService.test.ts`, `types.ts`, `src/routes/+page.svelte`, and `src/lib/controller/RouteController.ts`, `src/lib/controller/types.ts`.

ESLint errors:

- `src/lib/controller/RouteController.ts`: unused imports `ValidationCode` and `RouteFailure` (lines 5-6), unused `err` (36), four `any` types (192, 243, 244).
- `src/lib/controller/types.ts:47`: `route: any` (the file's own comment says to replace it with the Route type).
- `src/lib/ui/components/RouteFeedback.svelte:15`: `svelte/require-each-key`.
- `src/routes/+page.svelte:37` (3 errors): `@typescript-eslint/no-unused-expressions`.

## Tests written (all pass)

| File                                                        | Tests | What it checks                                                                                                                                           |
| ----------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/controller/RouteController.test.ts`                | 32    | Controller AC-1 to AC-4 on the real repository and engine: successful routes in all modes, every failure code, validation of every input, error messages |
| `src/lib/integration/ControllerAndApp.knownIssues.test.ts`  | 11    | The 10 known issues above plus 1 passing control check                                                                                                   |
| `src/lib/integration/RoutingCampusData.integration.test.ts` | 20    | Real seed data -> repository -> engine, all 3 modes, invariants over all 42 building pairs                                                               |
| `src/lib/campusdata/geo.test.ts`                            | 17    | Distance, point-in-polygon, polygon centroid                                                                                                             |
| `src/lib/campusdata/fetchJson.test.ts`                      | 10    | Loading the data file, success and failure paths                                                                                                         |
| `src/lib/campusdata/CampusValidation.test.ts`               | 23    | Rejection of bad data, corrections, disconnected paths                                                                                                   |
| `src/lib/ui/RouteServiceEdgeCases.test.ts`                  | 19    | HTTP status handling and malformed route responses                                                                                                       |
| `src/lib/routing/RouteEngine.contract.test.ts`              | 3     | Routing's reaction to a broken Campus Data contract                                                                                                      |
| `src/routes/campus-data-example/server.test.ts`             | 4     | The example data endpoint                                                                                                                                |

How the tests were checked: the code under test was deliberately broken in 17 places (stairs data, geometry logic, validation, HTTP error handling, Controller messages, status names, registered modes, entrance handling). Every harmful change made at least one test fail, and the original code was restored each time.

## Coverage (server tests, `src/lib`)

| Area             | Statements |
| ---------------- | ---------- |
| Overall          | 90.1%      |
| `lib/campusdata` | 94.3%      |
| `lib/routing`    | 98.1%      |
| `lib/controller` | 76.2%      |
| `lib/ui`         | 44.8%      |

The uncovered Controller lines are the map-point code (`findNearestNode`, `haversineDistance`), which cannot run until issue 1 is fixed. Full table: `coverage.txt`.

## Not yet tested

- **Map and components**: `MapLibreRenderer.ts`, `MapRenderer.ts` and the 5 Svelte components have no tests (0% coverage). They need a real browser, and no component test files (`*.svelte.test.ts`) exist, so the `client` Vitest project runs nothing.
- **End-to-end in the browser**: blocked by issues 7 and 8 (no endpoint, mismatched building ids).
