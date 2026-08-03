---
name: Odoo partner reads
description: How to read res.partner safely against this Odoo instance
---
The connected Odoo instance does NOT expose `mobile` on `res.partner`; a naive read requesting it fails, and a blanket catch that retries with fewer fields silently loses address data (this was the root cause of destinos showing client names).

**Why:** a degraded retry that drops city/street produced 727 orders with the customer name as `destino`.

**How to apply:** use `readPartners()` in `odooSync.ts` (fields_get-driven, degrades only non-address fields with logged warnings) for any res.partner read. Compose destinations with `buildDestino()`; never fall back to the partner name — use "Por definir".
