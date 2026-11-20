# Sprint 3 — Implementation Coverage and Progress

**Project:** UTEP Campus Route Finder  
**Team:** Team 4  
**Review Date:** November 19, 2026  
**Branch:** `experiment/real-campus-data`  
**Verified Commit:** `2f9bb8b`

## 1. Sprint Objective

Sprint 3 focuses on advancing the Campus Route Finder from a synthetic-data prototype into a working application that uses real UTEP geographic data. Work includes real-data integration, maintaining routing functionality, improving building selection, refactoring existing code, and expanding automated testing.

The two primary routing modes are Shortest and Easiest. Accurate elevation-aware routing remains dependent on obtaining and validating terrain elevation data.

## 2. Feature Coverage Matrix

| ID | Feature | Design Evidence | Implementation Evidence | Status |
|---|---|---|---|---|
| F-01 | Real OSM campus data loading | Campus Data CRC cards; CS-1 | DiskOsmCampusDataSource, campus-osm.json | Implemented |
| F-02 | OSM-to-campus graph transformation | OsmCampusTransformer CRC; OT-1 | OsmCampusTransformer.ts | Implemented |
| F-03 | Real campus building selection | BuildingCatalog CRC; BC-1 | BuildingCatalog.ts; campus.ts | Implemented |
| F-04 | Exclusion of unwanted buildings | BuildingCatalog CRC; BC-1 | BuildingCatalog.ts | Implemented |
| F-05 | Building marker coordinate preparation | BuildingCatalog CRC; BC-1 | BuildingCatalog.ts | Implemented |
| F-06 | Duplicate building ID prevention | BuildingCatalog CRC; BC-1 | BuildingCatalog.ts | Implemented |
| F-07 | Real-campus route calculation | RouteEngine CRC; RT-1 | RouteEngine.ts; API integration | Implemented |
| F-08 | Easiest routing policy | EasyRouteStrategy CRC; RS-1, RS-2 | EasyRouteStrategy.ts | Implemented using available data |
| F-09 | Reliable campus-wide elevation data | Campus Data design; OT-1 extension point | elevationLookup support exists; terrain dataset absent | Incomplete |
| F-10 | Geographic connectivity and entrance verification | Campus Data and BuildingCatalog contracts | Current inferred entrances and graph diagnostics | Partially implemented |

**Coverage summary:** Eight of the ten identified Sprint 3 feature areas have working implementations or implemented policy logic. Two still require substantial geographic-data work. This is an implementation-status summary, not a claim that all eight features were developed from scratch during Sprint 3.

The feature list should be reconciled with the team's approved remaining-feature backlog before using the count as the official rubric denominator.

## 3. CRC and Contract Coverage

The updated SDD documents relevant class responsibilities and collaborations through CRC cards for BuildingCatalog, CampusRepository, CampusGraph, DiskOsmCampusDataSource, OsmCampusTransformer, RouteEngine, RoutingStrategy, ShortestRouteStrategy, and EasyRouteStrategy.

The primary contracts supporting Sprint 3 include BC-1, CD-1, CS-1, OT-1, RT-1, RS-1, and RS-2.

## 4. CRC-to-Code Bridging

**PPP:** RouteEngine route-search pseudocode is mapped to validation, endpoint filtering, graph search, cost evaluation, and route reconstruction.

**Design by Contract:** BuildingCatalog's BC-1 contract defines filtered, unique building results with finite coordinates and no repository mutation.

**Test-first:** Duplicate-building prevention is represented by a focused regression test and implementation using a Set. The successful test result is verified; a historical failing Red-phase run is not included unless separately recorded.

## 5. Design Patterns and Refactoring

**Strategy Pattern:** RouteEngine delegates routing policies to ShortestRouteStrategy and EasyRouteStrategy.

**Adapter Pattern:** RoutingGraphAdapter converts CampusGraph records into the representation expected by Routing.

**Extract Class Refactoring:** BuildingCatalog was extracted from campus.ts to separate building-list preparation from application initialization. This refactoring has focused unit-test coverage.

The Strategy and Adapter patterns existed before this Sprint 3 review. A newly introduced or modified pattern should be identified with its own commit evidence before claiming the Part 3 design-pattern update requirement is complete.

## 6. Verified Test Results

**November 19, 2026**

- 20 test files passed.
- 343 automated tests passed.
- 0 tests failed.
- Svelte/TypeScript checking: 0 errors, 0 warnings.
- Production build completed successfully.
- OSM integration test loaded 51 buildings, 3,010 nodes, and 3,296 directed edges.

**Verification branch:** `experiment/real-campus-data`  
**Commit:** `2f9bb8b`

## 7. Remaining Limitations

The 45-meter entrance-inference threshold is provisional and does not guarantee a physically usable building entrance. Larry K. Durham Sports Center remains disconnected from the main modeled network. Some building marker locations require review, and LiDAR-derived elevation information has not been integrated.

## 8. Check-in Conclusion

The Sprint 3 implementation has functioning real-campus routing, updated architectural documentation, tested building-list refactoring, and a passing regression suite. Remaining work concentrates on geographic correctness, reliable elevation data, formal review evidence, and final integration before November 30.