---
name: Operational conflict serialization
description: Concurrency and shared-trip rules for dispatch schedule and load-mode validation
---

Schedule-conflict and partial/full load-mode validation must serialize every affected vehicle, person, and business order in a stable global order inside the write transaction. A transaction without a shared lock scope still allows two concurrent requests to validate stale snapshots and both commit.

**Why:** operators can submit the same stale plan from multiple tabs, and shared-trip creation stages several dispatches before the trip record exists. Exact matches of vehicle, driver, assistant, departure, and arrival represent one physical shared service; any non-exact overlap remains a conflict, including people crossing driver/assistant roles.

**How to apply:** any new dispatch or trip mutation path must join the same transaction-scoped lock protocol before reading conflicts. Preserve trip-first, ascending-trip-ID row locks for membership changes, and lock all candidate resource/order scopes in sorted order to avoid deadlocks.