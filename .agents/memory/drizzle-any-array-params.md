---
name: Drizzle raw ANY(ARRAY[...]) fails on integer columns
description: Why hand-built `= ANY(ARRAY[$1,$2])` SQL breaks and what to use instead
---

Hand-built `sql\`col = ANY(ARRAY[${...params}])\`` sends untyped params; Postgres infers `text` for the array elements and integer columns fail at runtime with "operator does not exist: integer = text" — only the single-param code path (plain `eq`) works, so the bug hides until a row has 2+ children.

**Why:** bit the deliveries endpoint: sales with one albarán rendered fine, sales with several 500'd.

**How to apply:** always use drizzle `inArray(col, ids)` for IN-list filters; never build `= ANY(ARRAY[...])` with raw interpolated params.
