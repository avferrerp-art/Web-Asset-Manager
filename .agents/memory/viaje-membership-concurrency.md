---
name: Viaje membership concurrency
description: Locking and uniqueness rules for safely moving dispatches between shared trips
---

Any dispatch membership write must lock every involved trip in ascending ID order before locking and rechecking the dispatch. Allocate a new stop order while holding the destination trip lock, and update both derived trip states before committing. Explicit no-op membership writes follow the same path.

While a dispatch remains in a trip, its vehicle, driver, and assistant are owned by the trip and direct dispatch-level edits to those fields must be rejected. They may be changed through the trip, or on the same request that detaches the dispatch.

Any dispatch-level edit that changes effective cargo must use the same trip transaction and validate the candidate against the sum of all trip members before writing; individual-fit checks are insufficient for consolidated capacity.

**Why:** separate reads and writes allow a concurrent trip edit or reassignment to leave stale vehicle/personnel data, duplicate stop orders, or stale derived states. A partial unique trip/order index is the final database guard.

**How to apply:** use the transactional membership operation for every request that contains a trip ID, including the same current ID or null, and for cargo edits on existing members. New operations that lock trips and dispatches must preserve the trip-first, ascending-trip-ID lock order. Route shared operational assignment changes and consolidated-capacity checks through the trip service.