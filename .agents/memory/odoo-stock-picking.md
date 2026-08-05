---
name: Odoo stock.picking / stock.move reads
description: Verified field names for albaranes (deliveries) on this Odoo 19 instance
---
The connected Odoo is **19.0+e**. Verified via fields_get (see `docs/odoo-albaranes-hallazgos.md` for full detail):
- Delivered qty on stock.move is **`quantity`** — `quantity_done` does NOT exist and requesting it fails.
- Picking lines field is **`move_ids`** only; `move_ids_without_package` and `move_lines` don't exist. `group_id` doesn't exist on stock.picking either.
- `sale_id` on stock.picking exists and is populated (30/30 sampled) — use it as the primary albarán→venta link; `origin` matches the SO ref exactly but can be false, "Devolución de …", or a typo.
- stock.location has no `code`/`partner_id`; use `complete_name`. stock.warehouse has no `complete_name`; use `name`/`code`.

**Why:** field names differ across Odoo versions and a nonexistent field in a read breaks the whole call (see odoo-partner-reads.md incident).

**How to apply:** when writing the albaranes sync, use these verified names and still guard reads with fields_get like `readPartners()` does.
