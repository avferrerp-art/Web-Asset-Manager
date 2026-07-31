---
name: Task-environment DB schema drift
description: The task environment's Postgres can be missing tables/columns that already exist in the code schema
---

The dev DB in a task environment may lag behind `lib/db/src/schema/*` — entire tables (e.g. a catalog table added by a parallel task) or columns can be absent, causing FK DDL or drizzle queries to fail with "relation/column does not exist".

**Why:** parallel tasks add schema in code, but their DDL was applied to a different environment's DB.

**How to apply:** before adding FKs or querying a table you didn't create, check `information_schema`; create any missing tables/columns with executeSql to match the code schema exactly, then proceed.
