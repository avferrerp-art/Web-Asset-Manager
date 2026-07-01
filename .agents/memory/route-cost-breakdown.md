---
name: Route cost breakdown model
description: How redondo/multidestino route distance and toll totals are computed and exposed to the frontend
---

Route distance/toll totals depend on `tipo` (sencillo | redondo | multidestino) and must not be computed ad-hoc in multiple places.

- `computeRouteCostBreakdown(route, tolls, waypoints)` (api-server `src/lib/routeCost.ts`) is the single source of truth. It returns `{ distanciaTotalKm, costoPeajesTotal, tramos }`.
- `redondo`: distance and tolls are both doubled (round trip).
- `multidestino`: distance is the sum of each waypoint leg (`route_waypoints.distanciaKm`, ordered by `orden`) plus `route.distanciaKm` reinterpreted as the final leg into `destino`. Tolls stay a flat sum (casetas aren't tied to a specific leg — that's out of scope).
- `sencillo`: unchanged, single leg, no doubling/summing.

**Why:** before this, `distanciaKm`/toll totals were read directly off the route record in several frontend pages and in dispatch cost estimation, so redondo/multidestino trips were silently under-costed (using only the one-way leg distance).

**How to apply:** any UI or backend code that needs a route's real distance or toll cost must read `route.distanciaTotalKm` / `route.costoPeajesTotal` (or the `CostEstimate.tramos` field from the dispatch cost-preview endpoint) — never `route.distanciaKm` or a raw `tolls.reduce(...)` sum directly, since those only reflect the sencillo/one-leg case.
