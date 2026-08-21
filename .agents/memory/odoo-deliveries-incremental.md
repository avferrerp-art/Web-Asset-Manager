---
name: Odoo deliveries incremental sync
description: How the albaranes sync stays cheap per 5-min poll and how to simulate change/cancel scenarios for testing
---
The deliveries sync must stay incremental on the READ side, not just writes: server-side domain filter `write_date >= watermark` (watermark = max local deliveries.odoo_write_date; Odoo datetime strings sort lexicographically) plus an id-only `search` of all outgoing pickings for deletion reconciliation. A code review rejected write-only batching as "not incremental".

**Why:** ~1000 pickings × every 5 min; reading all headers each cycle was deemed unacceptable.

**How to apply:** any new Odoo entity sync should filter by write_date server-side and detect deletions with a fields-less `search`. To simulate a change/cancel transition in tests, it is NOT enough to stale one row's odoo_write_date — the watermark is the global max, so also cap all rows' write_date at the candidate's remote write_date so the picking is refetched.

Historical imports are a special case: an internal-transfer backfill must query and reconcile only internal mirrors, and newly backfilled rows must not advance the normal `odoo_write_date` watermark.

**Why:** applying the normal all-picking deletion reconciliation during a transfer-only backfill could erase unrelated sale mirrors; stamping an old historical run with a newer source date could make the normal poll skip changes.

**How to apply:** keep historical mode scoped to its entity type for both remote-ID reconciliation and local deletion candidates. Leave the newly historical rows outside the normal watermark until ordinary polling sees a current Odoo change; verify a backfill followed by two normal polls preserves both the mirror and its dependent planning row.
