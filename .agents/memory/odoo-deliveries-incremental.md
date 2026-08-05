---
name: Odoo deliveries incremental sync
description: How the albaranes sync stays cheap per 5-min poll and how to simulate change/cancel scenarios for testing
---
The deliveries sync must stay incremental on the READ side, not just writes: server-side domain filter `write_date >= watermark` (watermark = max local deliveries.odoo_write_date; Odoo datetime strings sort lexicographically) plus an id-only `search` of all outgoing pickings for deletion reconciliation. A code review rejected write-only batching as "not incremental".

**Why:** ~1000 pickings × every 5 min; reading all headers each cycle was deemed unacceptable.

**How to apply:** any new Odoo entity sync should filter by write_date server-side and detect deletions with a fields-less `search`. To simulate a change/cancel transition in tests, it is NOT enough to stale one row's odoo_write_date — the watermark is the global max, so also cap all rows' write_date at the candidate's remote write_date so the picking is refetched.
